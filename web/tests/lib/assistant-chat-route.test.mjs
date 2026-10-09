import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { register } from "node:module";

const webSrc = fileURLToPath(new URL("../../src/", import.meta.url));
const loader = `
  import { existsSync } from "node:fs";
  import path from "node:path";
  import { pathToFileURL } from "node:url";
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(${JSON.stringify(webSrc)}, specifier.slice(2));
      for (const ext of [".ts", ".tsx", ".mjs", ".js", ""]) {
        if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, pathToFileURL(webSrc));

const { GET, PUT, DELETE } = await import("../../src/app/api/assistant/chats/route.ts");
const userMessages = [{ role: "user", parts: [{ type: "text", text: "Primeira mensagem" }] }];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "assistant-chat-route-"));
  const previous = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  t.after(() => {
    if (previous === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

async function put(body) {
  return PUT(new Request("http://fixture.invalid/api/assistant/chats", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

async function expectFailure(response, status, code, error) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error, code });
}

test("a busy conversation returns stable Portuguese copy without exposing the internal detail", async (t) => {
  const root = fixture(t);
  const id = randomUUID();
  assert.equal((await put({ id, revision: 0, messages: userMessages })).status, 200);
  writeFileSync(path.join(root, ".career-ops-web", "chats", `${id}.json.lock`), "");

  await expectFailure(
    await put({ id, revision: 1, messages: userMessages, title: "Novo nome" }),
    409,
    "busy",
    "Esta conversa está a ser alterada noutro processo. Tenta novamente dentro de instantes.",
  );
});

test("every chat validation code that reaches the console has stable Portuguese copy", async (t) => {
  fixture(t);
  const cases = [
    ["{", 400, "invalid-request", "O pedido não é válido."],
    [{ id: "not-an-id", revision: 0, messages: userMessages }, 400, "invalid-id", "A conversa indicada não é válida."],
    [{ id: randomUUID(), messages: userMessages }, 400, "revision-required", "Falta a versão da conversa. Recarrega-a e tenta novamente."],
    [{ id: randomUUID(), revision: 0, messages: [{ role: "system", content: "bad" }] }, 400, "invalid-messages", "A conversa contém mensagens inválidas e não foi guardada."],
    [{ id: randomUUID(), revision: 0, messages: [] }, 400, "empty", "As conversas vazias não são guardadas."],
    [{ id: randomUUID(), revision: 0, messages: userMessages, title: "" }, 400, "invalid-title", "O nome da conversa deve ter entre 1 e 100 caracteres."],
  ];
  for (const [body, status, code, error] of cases) {
    await expectFailure(await put(body), status, code, error);
  }
});

test("size, damaged-file and revision conflicts retain their HTTP status and use Portuguese copy", async (t) => {
  const root = fixture(t);
  const id = randomUUID();
  assert.equal((await put({ id, revision: 0, messages: userMessages })).status, 200);

  await expectFailure(
    await put({ id, revision: 0, messages: [{ role: "user", content: "Outra mensagem" }] }),
    409,
    "changed",
    "A conversa foi alterada noutro separador. Recarrega-a antes de continuar; o texto por guardar continua visível.",
  );
  await expectFailure(
    await DELETE(new Request(`http://fixture.invalid/api/assistant/chats?id=${id}&revision=0`, { method: "DELETE" })),
    409,
    "changed",
    "A conversa foi alterada noutro separador. Recarrega-a antes de continuar; o texto por guardar continua visível.",
  );
  await expectFailure(
    await put(JSON.stringify({ id: randomUUID(), revision: 0, messages: [{ role: "user", content: "x".repeat(1_001_000) }] })),
    413,
    "too-large",
    "A conversa é demasiado grande para ser guardada.",
  );

  const damaged = randomUUID();
  const dir = path.join(root, ".career-ops-web", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${damaged}.json`), "{broken");
  await expectFailure(
    await GET(new Request(`http://fixture.invalid/api/assistant/chats?id=${damaged}`)),
    409,
    "damaged",
    "Não foi possível ler esta conversa porque o ficheiro está danificado. O ficheiro não foi alterado.",
  );

  const list = await (await GET(new Request("http://fixture.invalid/api/assistant/chats"))).json();
  assert.deepEqual(list.errors, [{
    id: damaged,
    code: "damaged",
    error: "Não foi possível ler esta conversa porque o ficheiro está danificado. O ficheiro não foi alterado.",
  }]);
});
