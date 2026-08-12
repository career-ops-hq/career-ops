const DEFAULT_BASE_URL = "http://127.0.0.1:20129";
const DEFAULT_MODEL = "auto/external";

function cleanBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1].trim() : text);
}

function completionContent(text) {
  try {
    const payload = JSON.parse(text);
    return payload?.choices?.[0]?.message?.content || "";
  } catch {
    return text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => {
        try {
          const chunk = JSON.parse(line.slice(6));
          return chunk?.choices?.[0]?.delta?.content || chunk?.choices?.[0]?.message?.content || "";
        } catch {
          return "";
        }
      })
      .join("");
  }
}

function publicError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Okänt OmniRoute-fel");
}

function buildPrompt(offers, watch) {
  const clean = (value) => String(value || "").replace(/[|\n\r]/g, " ").trim();
  const jobLines = offers.map(
    (offer, index) => `${index + 1}|${clean(offer.title)}|${clean(offer.company)}|${clean(offer.location)}`,
  );

  return [
    "Poängsätt jobben 0-100 mot målet. Svara direkt med endast JSON: {\"scores\":[[1,90],[2,70]]}",
    `Roller=${(watch?.roles || []).map(clean).join(",")}`,
    `Orter=${(watch?.locations || []).map(clean).join(",")}`,
    `Nyckelord=${(watch?.includeKeywords || []).map(clean).join(",")}`,
    ...jobLines,
  ].join("\n");
}

export function createOmniRouteClient(options = {}) {
  const baseUrl = cleanBaseUrl(options.baseUrl || process.env.OMNIROUTE_BASE_URL);
  const model = String(options.model || process.env["OMNIROUTE_MODEL"] || DEFAULT_MODEL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || 120_000);
  const apiKey = String(options.apiKey || process.env.OMNIROUTE_API_KEY || "");

  if (typeof fetchImpl !== "function") throw new TypeError("fetch saknas");

  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  async function status() {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, {
        headers,
        signal: timeoutSignal(Math.min(timeoutMs, 8_000)),
      });
      if (!response.ok) throw new Error(`health HTTP ${response.status}`);
      const body = await response.json().catch(() => ({}));
      const modelsResponse = await fetchImpl(`${baseUrl}/v1/models`, {
        headers,
        signal: timeoutSignal(Math.min(timeoutMs, 8_000)),
      });
      const modelsBody = modelsResponse.ok ? await modelsResponse.json().catch(() => ({})) : {};
      const models = Array.isArray(modelsBody?.data)
        ? modelsBody.data.map((item) => String(item?.id || "")).filter(Boolean)
        : [];
      return {
        reachable: true,
        model,
        models,
        baseUrl,
        detail: body.status || body.message || "online",
      };
    } catch (error) {
      return { reachable: false, model, models: [], baseUrl, detail: publicError(error) };
    }
  }

  async function chat(prompt) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            stream: false,
            temperature: 0.2,
            messages: [{ role: "user", content: String(prompt || "") }],
          }),
          signal: timeoutSignal(timeoutMs),
        });
        const body = await response.text();
        if (!response.ok) {
          let detail = body;
          try {
            detail = JSON.parse(body)?.error?.message || body;
          } catch {
            // Keep the plain response body.
          }
          throw new Error(`HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 180)}` : ""}`);
        }
        const content = completionContent(body).trim();
        if (!content) throw new Error("Tomt svar från OmniRoute");
        return { ok: true, content, model };
      } catch (error) {
        lastError = error;
      }
    }
    return { ok: false, content: "", model, error: publicError(lastError) };
  }

  async function rank(offers, watch) {
    if (!Array.isArray(offers) || offers.length === 0) {
      return { ok: true, offers: [], model };
    }

    const candidates = offers.slice(0, 3);

    try {
      let response;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            stream: true,
            temperature: 0.1,
            max_tokens: 512,
            messages: [
              { role: "system", content: "Svara direkt utan resonemang. Returnera enbart JSON." },
              { role: "user", content: buildPrompt(candidates, watch) },
            ],
          }),
          signal: timeoutSignal(timeoutMs),
        });

        if (response.ok) break;
        const body = await response.text().catch(() => "");
        let detail = body;
        try {
          detail = JSON.parse(body)?.error?.message || body;
        } catch {
          // Keep the plain response body.
        }
        if (attempt === 1) {
          throw new Error(`HTTP ${response.status}${detail ? `: ${String(detail).slice(0, 180)}` : ""}`);
        }
      }

      const content = completionContent(await response.text());
      const parsed = parseJsonContent(content);
      const compactScores = Array.isArray(parsed?.scores)
        ? parsed.scores.map(([id, score]) => ({ id: `j${id}`, score, reason: "AI-rankad matchning" }))
        : [];
      const rankings = Array.isArray(parsed?.rankings) ? parsed.rankings : compactScores;
      const byId = new Map(rankings.map((item) => [String(item?.id || ""), item]));
      const byUrl = new Map(rankings.map((item) => [String(item?.url || ""), item]));
      const idByUrl = new Map(candidates.map((offer, index) => [offer.url, `j${index + 1}`]));
      const ranked = offers
        .map((offer) => {
          const aiRank = byId.get(idByUrl.get(offer.url)) || byUrl.get(offer.url);
          if (!aiRank) return offer;
          const aiScore = Math.max(0, Math.min(100, Number(aiRank.score) || 0));
          return {
            ...offer,
            score: Math.round((Number(offer.score) || 0) * 0.6 + aiScore * 0.4),
            aiScore,
            aiReason: String(aiRank.reason || "Matchningen bekräftad"),
          };
        })
        .sort((a, b) => b.score - a.score);

      return { ok: true, offers: ranked, model };
    } catch (error) {
      return {
        ok: false,
        offers: [...offers],
        model,
        error: publicError(error),
      };
    }
  }

  return { baseUrl, model, status, chat, rank };
}
