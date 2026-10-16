const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_BODY_CHARS = 9_000_000;
// Decoded image bytes cap (~4.5MB). Frontend downscales to ~1600px JPEG so a
// typical photo is 200-800KB; this cap rejects accidentally huge uploads
// before they hit Workers AI limits.
const MAX_IMAGE_BYTES = 4_500_000;
const IMAGE_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*"
    }
  });
}

function cleanText(value, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Validate the data URL and return the raw base64 payload plus mime type.
 * Returns { mime, base64 } or throws a user-facing Error (with statusCode).
 */
function parseDataUrl(image) {
  const match = IMAGE_RE.exec(image || "");
  if (!match) {
    const err = new Error("The image is missing or is not a supported image. Upload a JPG, PNG, WebP, or GIF photo.");
    err.statusCode = 400;
    throw err;
  }
  const comma = image.indexOf(",");
  const base64 = image.slice(comma + 1).replace(/\s/g, "");
  if (!base64 || base64.length < 20) {
    const err = new Error("The image appears to be empty. Please choose the photo again.");
    err.statusCode = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(base64.slice(0, 4096)) || base64.length < 4) {
    const err = new Error("The image data is damaged. Please choose the photo again or upload a fresh crop.");
    err.statusCode = 400;
    throw err;
  }
  // Approximate decoded size without allocating the full buffer.
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    const err = new Error("This image is too large for one request. Crop the page or upload a smaller photo.");
    err.statusCode = 413;
    throw err;
  }
  let mime = match[1].toLowerCase();
  if (mime === "jpg") mime = "jpeg";
  return { mime, base64, approxBytes };
}

function decodeToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length) {
    const err = new Error("The image appears to be empty. Please choose the photo again.");
    err.statusCode = 400;
    throw err;
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    const err = new Error("This image is too large for one request. Crop the page or upload a smaller photo.");
    err.statusCode = 413;
    throw err;
  }
  return bytes;
}

/**
 * Pull the generated text out of the many shapes Workers AI can return:
 * documented {response}, plain string, {result}, {description}, {text},
 * {output_text}/{output}, and OpenAI-compatible {choices[0].message.content}.
 * Returns "" when nothing readable is found (never throws).
 */
function extractModelText(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const t = extractModelText(item);
      if (t) return t;
    }
    return "";
  }
  if (output && typeof output === "object") {
    for (const key of ["response", "result", "description", "output_text", "text", "output", "content"]) {
      if (typeof output[key] === "string" && output[key].trim()) return output[key];
    }
    const choices = output.choices;
    if (Array.isArray(choices) && choices.length) {
      const msg = choices[0]?.message?.content ?? choices[0]?.text ?? choices[0]?.delta?.content;
      if (typeof msg === "string" && msg.trim()) return msg;
      if (Array.isArray(msg)) {
        const parts = msg.map(p => (typeof p === "string" ? p : p?.text || "")).filter(Boolean);
        if (parts.length) return parts.join("\n");
      }
    }
    const message = output.message;
    if (message && typeof message === "object") {
      const c = message.content;
      if (typeof c === "string" && c.trim()) return c;
    }
    // Last resort: if the object itself looks like the task payload, keep it.
    if (Array.isArray(output.tasks) || typeof output.transcription === "string") return JSON.stringify(output);
  }
  return "";
}

function stripFences(text) {
  return String(text || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/**
 * Try to parse structured JSON from model text. Returns the object, or null
 * when the text is not JSON (caller falls back to plain-text handling).
 */
function tryParseModelJson(text) {
  const cleaned = stripFences(text);
  if (!cleaned) return null;
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === "object") return direct;
  } catch {}
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const sub = JSON.parse(cleaned.slice(start, end + 1));
      if (sub && typeof sub === "object") return sub;
    } catch {}
  }
  return null;
}

/**
 * Plain-text fallback: treat the raw model output as a transcription and
 * derive conservative low-confidence task candidates from bullet/numbered
 * lines. Never invents details; marks everything for human review.
 */
const PLAINTEXT_SKIP = /^(sure\b|of course\b|here(?:'s| is| are)\b|i can\b|i(?:'ll| will)\b|as an ai\b|the image (shows|contains|appears|seems)\b|these tasks\b|it'?s worth noting\b|however,|based on the\b|unfortunately\b|please note\b|in (this|the) image\b)/i;

function tasksFromPlainText(text) {
  const transcription = cleanText(text, 5000);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(l => l
      .replace(/^[\s>]*([-*•\d.)\]]+\s+)/, "")
      .replace(/[*_`#]+/g, "")
      .trim())
    .filter(l => l.length >= 12 && l.length <= 220)
    .filter(l => !PLAINTEXT_SKIP.test(l))
    .filter(l => !/:$/.test(l))
    .filter(l => !/^(transcription|tasks?|notes?)\s*:?$/i.test(l))
    .filter(l => !/^[\W_]+$/.test(l))
    .filter(l => !/^\{/.test(l))
    .filter(l => !/^as an? ai\b/i.test(l))
    .slice(0, 10);
  const tasks = lines.map(line => ({
    title: line.slice(0, 180),
    description: line.slice(0, 1600),
    department: "Facilities",
    location: "Unknown",
    personInCharge: "Unassigned",
    priority: "Medium",
    type: "Maintenance",
    tags: ["#fac"],
    confidence: 0.3,
    uncertainText: [line.slice(0, 180)]
  }));
  return { transcription, tasks };
}

const DEPARTMENTS = ["Facilities", "Custodial", "Multimedia", "Worship", "Events", "Administration"];
const PRIORITIES = ["High", "Medium", "Low"];

function sanitizeTasks(rawTasks, people) {
  return (Array.isArray(rawTasks) ? rawTasks : []).slice(0, 40).map((t) => {
    let confidence = Number(t?.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.45;
    if (confidence > 1) confidence /= 100;
    confidence = Math.max(0, Math.min(1, confidence));
    const title = cleanText(t?.title, 180);
    const person = confidence >= 0.8 && people.includes(cleanText(t?.personInCharge, 80))
      ? cleanText(t.personInCharge, 80)
      : "Unassigned";
    return {
      title: title || "Unclear handwritten task — verify",
      description: cleanText(t?.description, 1600) || "[unclear — compare with original note]",
      department: DEPARTMENTS.includes(t?.department) ? t.department : "Facilities",
      location: cleanText(t?.location, 120) || "Unknown",
      personInCharge: person,
      priority: PRIORITIES.includes(t?.priority) ? t.priority : "Medium",
      type: t?.type === "Task" ? "Task" : "Maintenance",
      tags: Array.isArray(t?.tags) ? t.tags.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 8) : ["#fac"],
      confidence,
      uncertainText: Array.isArray(t?.uncertainText) ? t.uncertainText.map(x => cleanText(x, 180)).filter(Boolean).slice(0, 12) : []
    };
  }).filter(t => t.title);
}

function mapAiError(message) {
  const m = String(message || "");
  if (/license|agree|accept|meta.*policy/i.test(m))
    return "Cloudflare's vision model needs its one-time license acceptance before first use. The model must be enabled for this account, then try again.";
  if (/rate|limit|quota|billing|busy|overloaded|capacity/i.test(m))
    return "The AI service is temporarily rate-limited or has reached its usage limit. Wait a moment and try again.";
  if (/timeout|timed out|abort|took too long/i.test(m))
    return "The handwriting service timed out on this image. Try a smaller crop of the writing and attempt again.";
  if (/no.*image|invalid.*image|unsupported|decode|too large|payload/i.test(m))
    return "The image could not be processed. Try a close, well-lit JPG photo under a few megabytes.";
  return "The handwriting service could not finish reading this image. Try a close, well-lit crop of the writing. If this keeps happening, check the Workers AI binding and model availability.";
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return json({
      error: "The AI service is not connected yet. In Cloudflare, open Workers & Pages → steward-organizer → Settings → Functions/Bindings (or Settings → Bindings), add a Workers AI binding named AI, then redeploy."
    }, 503);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: "This image is too large. Upload a smaller photo or crop it closer to the writing." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "The upload could not be read. Please select the image again." }, 400);
  }

  const image = typeof body.image === "string" ? body.image : "";
  if (image.length > MAX_BODY_CHARS - 1000) {
    return json({ error: "This image is too large for one request. Crop the page or upload a smaller photo." }, 413);
  }
  let parsedImage;
  try {
    parsedImage = parseDataUrl(image);
  } catch (e) {
    return json({ error: e.message }, e.statusCode || 400);
  }

  const people = Array.isArray(body.people) ? body.people.map(x => cleanText(x, 80)).filter(Boolean).slice(0, 100) : [];
  const patterns = Array.isArray(body.pastorPatterns) ? body.pastorPatterns.slice(0, 80).map(p => ({
    sourceText: cleanText(p?.sourceText, 220),
    correctedTitle: cleanText(p?.correctedTitle, 180),
    department: cleanText(p?.department, 80),
    person: cleanText(p?.person, 80),
    tags: Array.isArray(p?.tags) ? p.tags.map(x => cleanText(x, 40)).slice(0, 8) : []
  })).filter(p => p.sourceText || p.correctedTitle) : [];

  const system = `You are a careful handwriting transcription and task extraction assistant for a church operations organizer. The image may contain difficult, rushed handwriting. Do not give up just because some words are difficult. Inspect the entire image carefully, infer only when context strongly supports it, and mark genuinely unclear words instead of inventing them. Never claim certainty you do not have.

First transcribe what is actually visible. Then identify actionable tasks. Use the supplied people list and verified correction examples only as context, not as permission to invent missing text. Examples may help recognize names, shorthand, recurring locations, and the pastor's writing patterns. Do not treat old examples as facts about this image.

Return ONLY valid JSON, no markdown, in this exact shape:
{
  "notes": "brief note about legibility and any unresolved parts",
  "transcription": "best-effort line-by-line transcription; use [unclear] for unreadable words",
  "tasks": [
    {
      "title": "short actionable task title",
      "description": "relevant transcription and task details; preserve uncertainty with [unclear]",
      "department": "one of Facilities, Custodial, Multimedia, Worship, Events, Administration",
      "location": "location from note or Unknown",
      "personInCharge": "exact supplied name only if clearly supported, otherwise Unassigned",
      "priority": "High, Medium, or Low",
      "type": "Task or Maintenance",
      "tags": ["#fac"],
      "confidence": 0.0,
      "uncertainText": ["exact snippets that need human review"]
    }
  ]
}

Confidence is a conservative estimate of how well this task's title and key details are supported by the image, from 0 to 1. This is not a calibrated probability. Use below 0.8 whenever any important word, person, location, or task meaning is uncertain. If the page contains actionable writing but no detail is fully readable, return best-effort tasks with low confidence and [unclear] markers rather than returning no tasks. Do not convert reminders or completed actions into new tasks unless the note clearly asks for action. Ignore unrelated decorative text. Do not assign a person unless their name is readable and unambiguously linked to that task.`;

  const userPrompt = [
    "Read this handwritten church operations note. Work slowly and carefully.",
    "Image handling: inspect all lines, including the margins. The page may be a dense grid or table of short phrases — treat each cell or phrase as a separate candidate item. Handwriting may be rushed. Use nearby words, repeated letter shapes, and context to compare possible readings. Do not silently replace an unclear word with a guess.",
    "Known people in the task register: " + (people.length ? people.join(", ") : "No people supplied."),
    "Pastor-specific verified examples (use as pattern hints only): " + (patterns.length ? JSON.stringify(patterns) : "No verified examples yet."),
    "Required: return your best-effort transcription and all plausible actionable tasks. Use [unclear] for uncertain words and a low confidence score when necessary."
  ].join("\n\n");

  // Preferred (non-deprecated) input: messages with a data-URL image part.
  // See @cloudflare/workers-types: image_url.url accepts
  // "data:image/jpeg;base64,...". Falls back to the legacy
  // { prompt, image: number[] } shape if the runtime rejects messages.
  const messagesInput = {
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: image } }
        ]
      }
    ],
    max_tokens: 3000,
    temperature: 0.1
  };

  let rawOutput;
  let inputMode = "messages-image-url";
  try {
    rawOutput = await env.AI.run(MODEL, messagesInput);
  } catch (firstError) {
    const firstMsg = String(firstError?.message || "");
    // Retry once with the legacy byte-array shape (sync-input.json:
    // image is number[] of 8-bit values). This covers runtimes that do not
    // accept messages-with-image for this model.
    let bytes;
    try {
      bytes = decodeToBytes(parsedImage.base64);
    } catch (decodeError) {
      return json({ error: decodeError.message }, decodeError.statusCode || 400);
    }
    try {
      rawOutput = await env.AI.run(MODEL, {
        prompt: system + "\n\n" + userPrompt,
        image: Array.from(bytes),
        max_tokens: 3000,
        temperature: 0.1
      });
      inputMode = "legacy-bytes";
    } catch (secondError) {
      const message = String(secondError?.message || firstMsg || "");
      return json({ error: mapAiError(message), detail: message.slice(0, 300) }, 502);
    }
  }

  try {
    const modelText = extractModelText(rawOutput);
    if (!modelText || !modelText.trim()) {
      return json({
        error: "The handwriting model returned an empty response. Try a closer, well-lit photo of the writing.",
        detail: String(JSON.stringify(rawOutput) || "").slice(0, 300)
      }, 502);
    }

    const parsed = tryParseModelJson(modelText);
    if (parsed) {
      const tasks = sanitizeTasks(parsed.tasks, people);
      const transcription = cleanText(parsed.transcription, 5000);
      const notes = cleanText(parsed.notes, 1000);
      if (!tasks.length && !transcription) {
        return json({
          error: "The handwriting model returned an unreadable response. Try a closer photo.",
          detail: modelText.slice(0, 300)
        }, 502);
      }
      return json({
        tasks,
        notes: notes || (tasks.length ? "" : "No clearly actionable tasks were found. Review the transcription and try a closer crop if writing is cut off."),
        transcription,
        model: MODEL,
        inputMode,
        reviewRequired: true
      });
    }

    // Non-JSON but non-empty: keep the transcription, and (stage 2) ask the
    // model to structure it. Only one extra text-only call, and only when the
    // vision pass produced substantial readable text.
    const fallback = tasksFromPlainText(modelText);
    if (fallback.transcription && fallback.transcription.length >= 40) {
      try {
        const structuring = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: "Convert this transcription of a handwritten church operations note into the required JSON shape (notes, transcription, tasks) and return ONLY that JSON, no explanations and no markdown fences. Do not invent tasks. Transcription:\n\n" + fallback.transcription.slice(0, 4000)
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 2000,
          temperature: 0
        });
        const stage2Text = extractModelText(structuring);
        const stage2 = tryParseModelJson(stage2Text);
        if (stage2) {
          const tasks = sanitizeTasks(stage2.tasks, people);
          return json({
            tasks,
            notes: cleanText(stage2.notes, 1000) || "The vision model returned plain text, which was converted to tasks in a follow-up step. Verify against the photo.",
            transcription: cleanText(stage2.transcription, 5000) || fallback.transcription,
            model: MODEL,
            inputMode: inputMode + "+text-structure",
            reviewRequired: true
          });
        }
      } catch {
        // Fall through to transcription-only response below.
      }
    }

    if (fallback.tasks.length) {
      return json({
        tasks: sanitizeTasks(fallback.tasks, people),
        notes: "The model returned readable text but not structured data, so tasks were derived conservatively. Verify each line against the photo.",
        transcription: fallback.transcription,
        model: MODEL,
        inputMode: inputMode + "+plaintext-fallback",
        reviewRequired: true
      });
    }
    return json({
      tasks: [],
      notes: "The writing could not be confidently transcribed. Try a closer, well-lit photo, one page at a time.",
      transcription: fallback.transcription,
      model: MODEL,
      inputMode,
      reviewRequired: true
    });
  } catch (error) {
    const message = String(error?.message || "");
    return json({ error: mapAiError(message), detail: message.slice(0, 300) }, 502);
  }
}
