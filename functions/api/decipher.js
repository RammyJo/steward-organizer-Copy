const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_BODY_CHARS = 9_000_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function cleanText(value, max = 1200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseModelJson(raw) {
  if (raw && typeof raw === "object") {
    if (typeof raw.response === "string") raw = raw.response;
    else if (typeof raw.result === "string") raw = raw.result;
    else return raw;
  }
  const text = String(raw || "").trim()
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error("The handwriting model returned an unreadable response. Try a closer photo.");
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Content-Type" }
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
  if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(image)) {
    return json({ error: "The image is missing or is not a supported image. Upload a JPG, PNG, WebP, or GIF photo." }, 400);
  }
  if (image.length > MAX_BODY_CHARS - 1000) {
    return json({ error: "This image is too large for one request. Crop the page or upload a smaller photo." }, 413);
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
    "Image handling: inspect all lines, including the margins. Handwriting may be rushed. Use nearby words, repeated letter shapes, and context to compare possible readings. Do not silently replace an unclear word with a guess.",
    "Known people in the task register: " + (people.length ? people.join(", ") : "No people supplied."),
    "Pastor-specific verified examples (use as pattern hints only): " + (patterns.length ? JSON.stringify(patterns) : "No verified examples yet."),
    "Required: return your best-effort transcription and all plausible actionable tasks. Use [unclear] for uncertain words and a low confidence score when necessary."
  ].join("\n\n");

  try {
    const output = await env.AI.run(MODEL, {
      prompt: userPrompt,
      image,
      max_tokens: 3000,
      temperature: 0.1
    });
    const parsed = parseModelJson(output);
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const tasks = rawTasks.slice(0, 40).map((t) => {
      let confidence = Number(t?.confidence);
      if (!Number.isFinite(confidence)) confidence = 0.45;
      if (confidence > 1) confidence /= 100;
      confidence = Math.max(0, Math.min(1, confidence));
      const title = cleanText(t?.title, 180);
      const person = confidence >= 0.8 && people.includes(cleanText(t?.personInCharge, 80))
        ? cleanText(t.personInCharge, 80)
        : "Unassigned";
      const departments = ["Facilities", "Custodial", "Multimedia", "Worship", "Events", "Administration"];
      const priorities = ["High", "Medium", "Low"];
      return {
        title: title || "Unclear handwritten task — verify",
        description: cleanText(t?.description, 1600) || "[unclear — compare with original note]",
        department: departments.includes(t?.department) ? t.department : "Facilities",
        location: cleanText(t?.location, 120) || "Unknown",
        personInCharge: person,
        priority: priorities.includes(t?.priority) ? t.priority : "Medium",
        type: t?.type === "Task" ? "Task" : "Maintenance",
        tags: Array.isArray(t?.tags) ? t.tags.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 8) : ["#fac"],
        confidence,
        uncertainText: Array.isArray(t?.uncertainText) ? t.uncertainText.map(x => cleanText(x, 180)).filter(Boolean).slice(0, 12) : []
      };
    }).filter(t => t.title);
    return json({
      tasks,
      notes: cleanText(parsed.notes, 1000),
      transcription: cleanText(parsed.transcription, 5000),
      model: MODEL,
      reviewRequired: true
    });
  } catch (error) {
    const message = String(error?.message || "");
    return json({
      error: /license|agree|accept/i.test(message)
        ? "Cloudflare's vision model needs its one-time license acceptance before first use. The model must be enabled for this account, then try again."
        : /rate|limit|quota|billing/i.test(message)
          ? "The AI service is temporarily rate-limited or has reached its usage limit. Wait a moment and try again."
          : "The handwriting service could not finish reading this image. Try a close, well-lit crop of the writing. If this keeps happening, check the Workers AI binding and model availability.",
      detail: message.slice(0, 300)
    }, 502);
  }
}
