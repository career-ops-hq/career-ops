// tests/sandbox-node-modules-link.test.mjs — linkNodeModules(), the guarded way
// a sandbox borrows the repo's installed dependency tree.
//
// The defect this exists to prevent is silent and misattributes itself.
// Sections that run a script copied out of the repo link ROOT/node_modules into
// the sandbox so the copy can still resolve its package imports. symlinkSync
// succeeds against a target that does not exist, so on a checkout where
// dependencies were never installed the link is created dangling, the child
// process dies with ERR_MODULE_NOT_FOUND, and the section's catch reports that
// as a crash of whatever the test was actually about. That is a red assertion
// pointing at innocent code.
//
// The suite is designed to run on a fresh clone with only Node (see the
// tests/helpers.mjs header), where an absent node_modules is the expected state
// and has to be reported as itself.
import { pass, fail, warn, run, stripJsComments, codeMask, isCodeRange, ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, lstatSync, symlinkSync, readlinkSync, chmodSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';

console.log('\nsandbox node_modules link — the dependency tree a copied script borrows');

const tmp = mkdtempSync(join(tmpdir(), 'career-ops-nm-link-'));
try {
  const { linkNodeModules } = await import(pathToFileURL(join(ROOT, 'tests/helpers.mjs')).href);

  if (typeof linkNodeModules !== 'function') {
    fail('tests/helpers.mjs does not export linkNodeModules()');
  } else {
    // Installed tree: the link is made, and a package behind it is readable
    // through the sandbox path. Asserting the link merely exists would pass on
    // a dangling one, which is the bug.
    {
      const root = join(tmp, 'installed');
      mkdirSync(join(root, 'node_modules', 'demo-pkg'), { recursive: true });
      writeFileSync(join(root, 'node_modules', 'demo-pkg', 'marker.txt'), 'reachable', 'utf-8');
      const sandbox = join(tmp, 'sandbox-installed');
      mkdirSync(sandbox, { recursive: true });

      const reason = linkNodeModules(sandbox, root);
      if (reason === null) {
        pass('linkNodeModules returns null when the dependency tree is installed');
      } else {
        fail(`linkNodeModules refused an installed tree: ${reason}`);
      }

      let through = null;
      try {
        through = readFileSync(join(sandbox, 'node_modules', 'demo-pkg', 'marker.txt'), 'utf-8');
      } catch (err) {
        through = `unreadable: ${err.code}`;
      }
      if (through === 'reachable') {
        pass('a package inside the linked tree is readable through the sandbox path');
      } else {
        fail(`reading through the sandbox link produced ${JSON.stringify(through)}`);
      }
    }

    // Absent tree: the caller is told why, in terms it can act on.
    {
      const root = join(tmp, 'bare-clone');
      mkdirSync(root, { recursive: true });
      const sandbox = join(tmp, 'sandbox-bare');
      mkdirSync(sandbox, { recursive: true });

      const reason = linkNodeModules(sandbox, root);
      if (typeof reason === 'string' && reason.length > 0) {
        pass('linkNodeModules reports a reason when the dependency tree is absent');
      } else {
        fail(`linkNodeModules returned ${JSON.stringify(reason)} for a root with no node_modules`);
      }
      if (typeof reason === 'string' && reason.includes(root)) {
        pass('the reason names the root whose tree is missing');
      } else {
        fail(`the reason does not name the root: ${JSON.stringify(reason)}`);
      }
      if (typeof reason === 'string' && /npm ci/.test(reason)) {
        pass('the reason names the remedy (npm ci), so the operator can act on it');
      } else {
        fail(`the reason does not name the remedy: ${JSON.stringify(reason)}`);
      }

      // The load-bearing assertion. lstatSync, because existsSync follows the
      // link and is already false for a dangling one, so it cannot tell "no
      // link was created" from "a broken link was created". A broken link is
      // exactly what an unguarded symlinkSync leaves behind.
      let entry = 'present';
      try {
        lstatSync(join(sandbox, 'node_modules'));
      } catch (err) {
        entry = err.code;
      }
      if (entry === 'ENOENT') {
        pass('no link entry is left behind when the tree is absent (no dangling symlink)');
      } else {
        fail(`linkNodeModules left a node_modules entry behind (lstat: ${entry}); a dangling link is what breaks the sandbox`);
      }
    }

    // Unreadable tree: a different reason, and still a skip. `npm ci` is the
    // wrong advice for a node_modules that is there and cannot be stat'd, and
    // throwing would land in the call site's catch, which is the
    // misattribution this whole guard exists to prevent. A self-referential
    // symlink gives ELOOP without needing a chmod that root would ignore.
    {
      const root = join(tmp, 'looping-clone');
      mkdirSync(root, { recursive: true });
      const loop = join(root, 'node_modules');
      const sandbox = join(tmp, 'sandbox-loop');
      mkdirSync(sandbox, { recursive: true });

      let made = true;
      try {
        symlinkSync(loop, loop);
      } catch {
        made = false; // Windows without the symlink privilege.
      }
      if (made) {
        const reason = linkNodeModules(sandbox, root);
        if (typeof reason === 'string' && /unreadable \(ELOOP\)/.test(reason)) {
          pass('an unreadable tree reports its errno instead of advising npm ci');
        } else {
          fail(`a looping node_modules produced ${JSON.stringify(reason)}`);
        }

        let entry = 'present';
        try {
          lstatSync(join(sandbox, 'node_modules'));
        } catch (err) {
          entry = err.code;
        }
        if (entry === 'ENOENT') {
          pass('no link entry is left behind when the tree is unreadable');
        } else {
          fail(`linkNodeModules linked against an unreadable tree (lstat: ${entry})`);
        }
      }
    }

    // A regular file standing where the tree belongs. statSync succeeds on it, so
    // before the isDirectory check an executable one linked cleanly and handed the
    // sandbox a symlink to a file. Both modes, because 0755 was the one that got
    // through and 0644 was reported as unreadable rather than as what it is.
    {
      for (const mode of [0o644, 0o755]) {
        const root = join(tmp, `file-clone-${mode.toString(8)}`);
        const sandbox = join(tmp, `sandbox-file-${mode.toString(8)}`);
        mkdirSync(root, { recursive: true });
        mkdirSync(sandbox, { recursive: true });
        const nm = join(root, 'node_modules');
        writeFileSync(nm, 'not a directory');
        chmodSync(nm, mode);

        const reason = linkNodeModules(sandbox, root);
        if (typeof reason === 'string' && /is not a directory/.test(reason)) {
          pass(`a file where node_modules belongs is refused (mode ${mode.toString(8)})`);
        } else {
          fail(`a file at node_modules (mode ${mode.toString(8)}) produced ${JSON.stringify(reason)}`);
        }

        let entry = 'present';
        try {
          lstatSync(join(sandbox, 'node_modules'));
        } catch (err) {
          entry = err.code;
        }
        if (entry === 'ENOENT') {
          pass(`no link entry is left behind for a file at node_modules (mode ${mode.toString(8)})`);
        } else {
          fail(`linkNodeModules linked against a file (mode ${mode.toString(8)}, lstat: ${entry})`);
        }
      }
    }

    // Directory permission, both ways. What module resolution needs from
    // node_modules is TRAVERSE, not read: Node stats paths underneath it rather
    // than listing it. So the two failing modes fall on opposite sides of the
    // obvious check, and a tree that only LISTS is the one that breaks --
    //
    //   0111  no read, traverses -> import works, so linking is correct
    //   0444  reads, no traverse -> import dies EACCES, so a reason is correct
    //
    // -- which is why both are here. A readability probe inverts both rows: it
    // would skip the tree that works and link against the one that does not,
    // handing the call site the EACCES misattribution this guard exists to
    // remove. Skipped where the mode does not bite: root ignores it, and
    // Windows has no bit to set.
    {
      const modes = [
        { mode: 0o111, name: 'traversable but unreadable', linksOk: true },
        { mode: 0o444, name: 'readable but not traversable', linksOk: false },
      ];
      for (const { mode, name, linksOk } of modes) {
        const root = join(tmp, `perm-clone-${mode.toString(8)}`);
        const nm = join(root, 'node_modules');
        const sandbox = join(tmp, `sandbox-perm-${mode.toString(8)}`);
        mkdirSync(nm, { recursive: true });
        mkdirSync(sandbox, { recursive: true });

        // Only run the row where the mode had the effect the row describes.
        // Traversable has to equal linksOk by construction; where it does not,
        // the bit was ignored -- root, or a filesystem that does not carry it.
        chmodSync(nm, mode);
        let traversable = true;
        try { accessSync(nm, constants.X_OK); } catch { traversable = false; }
        if (traversable !== linksOk) {
          // Say so. A bare `continue` leaves the reader to notice that 2 of 15
          // lines are absent, which is how an unexercised guard reads as a
          // working one.
          warn(`skipped the ${name} row: mode ${mode.toString(8)} did not take effect here`);
          chmodSync(nm, 0o755);
          continue;
        }

        const reason = linkNodeModules(sandbox, root);
        if (linksOk && reason === null) {
          pass(`a ${name} tree is linked, not skipped`);
        } else if (!linksOk && typeof reason === 'string' && /unreadable \(EACCES\)/.test(reason)) {
          pass(`a ${name} tree reports EACCES instead of linking`);
        } else {
          fail(`a ${name} node_modules produced ${JSON.stringify(reason)}`);
        }

        let entry = 'present';
        try {
          lstatSync(join(sandbox, 'node_modules'));
        } catch (err) {
          entry = err.code;
        }
        if ((entry === 'ENOENT') === !linksOk) {
          pass(`the link entry matches the verdict for a ${name} tree`);
        } else {
          fail(`a ${name} tree returned ${JSON.stringify(reason)} but left lstat: ${entry}`);
        }
        chmodSync(nm, 0o755);
      }
    }

    // The repo's own root is the default, so call sites do not repeat it. Held
    // against an explicit ROOT call, because this machine's own state decides
    // almost nothing here: where dependencies are installed, "returned null" is
    // true of any default root that happens to have a tree, the wrong one
    // included. Two sandboxes, since the second call would hit EEXIST on the
    // first one's link.
    {
      const viaDefault = join(tmp, 'sandbox-default');
      const viaExplicit = join(tmp, 'sandbox-explicit');
      mkdirSync(viaDefault, { recursive: true });
      mkdirSync(viaExplicit, { recursive: true });

      const defaulted = linkNodeModules(viaDefault);
      const explicit = linkNodeModules(viaExplicit, ROOT);
      // readlink on both sides, so the two targets come back through one API on
      // one platform and compare verbatim. A Windows junction needs no
      // normalization against another junction.
      const targetOf = (sandbox) => {
        try {
          return readlinkSync(join(sandbox, 'node_modules'));
        } catch (err) {
          return err.code;
        }
      };
      if (defaulted === explicit && targetOf(viaDefault) === targetOf(viaExplicit)) {
        pass('linkNodeModules defaults its root to ROOT (same reason and same link target as passing it)');
      } else {
        fail(`default root gave ${JSON.stringify(defaulted)} -> ${targetOf(viaDefault)}, explicit ROOT gave ${JSON.stringify(explicit)} -> ${targetOf(viaExplicit)}`);
      }
    }

    // The reason only helps if the call site reads it. The guard lives inside
    // linkNodeModules now, so the one thing a caller can still get wrong is
    // sandboxing anyway once a reason comes back: the child dies with
    // ERR_MODULE_NOT_FOUND and the section's catch blames the contract it was
    // testing, which is the defect this whole file exists for. That branch runs
    // only where dependencies are absent, so no ordinary run would notice it
    // going missing.
    {
      const callSite = stripJsComments(readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8'));
      const bound = callSite.match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*linkNodeModules\s*\(/);
      // The name comes out of a file this check reads, so every regex
      // metacharacter gets escaped. A partial escape is the incomplete-escaping
      // defect itself.
      const name = bound && bound[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const guard = bound && new RegExp(`\\bif\\s*\\(\\s*${name}\\b`);
      const guardAt = bound ? callSite.search(guard) : -1;
      // Branching is only half of the contract. The branch also has to LEAVE
      // the block. Where dependencies are installed the reason is falsy, so a
      // guard whose body stopped breaking out still passes every ordinary run
      // while the dangling-link sandbox it exists to prevent comes straight
      // back. Asserting the `if` alone is therefore vacuous against exactly the
      // edit most likely to happen: someone keeps the warn and drops the break.
      // Walk the braces of the matched `if` and require an exit inside its own
      // body. Comments are already stripped, so only an unbalanced brace inside
      // a string literal could mis-slice this; that direction fails loudly
      // rather than passing quietly, which is the right way for it to be wrong.
      const guardBody = () => {
        const open = callSite.indexOf('{', guardAt);
        if (open === -1) return '';
        let depth = 0;
        for (let i = open; i < callSite.length; i++) {
          if (callSite[i] === '{') depth++;
          else if (callSite[i] === '}' && --depth === 0) return callSite.slice(open + 1, i);
        }
        return '';
      };
      const EXITS_BLOCK = /\b(?:break\s+[A-Za-z_$][\w$]*|return)\s*;/;
      if (!bound) {
        fail('test-all.mjs calls linkNodeModules() without binding the reason, so it cannot skip on one');
      } else if (guardAt === -1) {
        fail(`test-all.mjs binds linkNodeModules() to ${bound[1]} and never branches on it; an absent tree would sandbox dangling again`);
      } else if (!EXITS_BLOCK.test(guardBody())) {
        fail(`test-all.mjs branches on ${bound[1]}, but that branch never breaks or returns, so an absent tree falls through into the sandboxed run anyway`);
      } else {
        pass('test-all.mjs branches on the reason linkNodeModules returns, and that branch leaves the block');
      }
    }
  }

  // ── The class, not the 2 instances this PR started from ────────────────────
  //
  // Routing the 2 known call sites through linkNodeModules() does not stop a
  // third from being written, and one already was: #4486 added
  // tests/writer-scripts-data-root.test.mjs with a raw symlinkSync and a catch
  // whose comment says "already there" while swallowing EPERM on a Windows box
  // with no Developer Mode. Two of its cases then failed as ERR_MODULE_NOT_FOUND,
  // which is exactly the misattribution this helper exists to prevent, and CI's
  // Windows runner can create the 'dir' link so nothing there ever showed it.
  //
  // So the rule is checked across every tracked test instead of at the sites that
  // happened to exist when it was written.
  //
  // KNOWN LIMIT: the scan reads the FIRST argument of each symlinkSync call and
  // flags one naming node_modules, which is the repo's own tree being linked
  // somewhere else. A site that hoists that path into a variable first is not
  // caught. An ALIASED import is, separately, because renaming this import defeats
  // the scan entirely and no caller has a reason to. Not caught either: a site that
  // only puts node_modules in the DESTINATION:
  // tests/gitignore-symlink-escape.test.mjs does that deliberately to build a
  // path-escape fixture, and it is not this defect.
  {
    const firstArgOf = (src) => {
      const out = [];
      const re = /\bsymlinkSync\s*\(/g;
      let m;
      while ((m = re.exec(src))) {
        let depth = 0, arg = '';
        for (let i = m.index + m[0].length; i < src.length; i++) {
          const ch = src[i];
          if (ch === '(' || ch === '[') depth++;
          else if (ch === ')' || ch === ']') { if (depth === 0) break; depth--; }
          else if (ch === ',' && depth === 0) break;
          arg += ch;
        }
        out.push({ index: m.index, arg: arg.trim() });
      }
      return out;
    };

    // A call inside a comment or a string is prose, not a link, and this suite
    // documents the exact shapes it forbids -- so a scan that cannot tell them
    // apart flags its own text. codeMask() answers that per character and leaves
    // the source itself alone, which both halves of this need: the predicate is
    // the `'node_modules'` path LITERAL, so a masker that blanks strings blanks
    // the evidence, and untouched offsets let a failure name a real line.
    // The binding name is deliberately unmatched. Pinning it to [A-Za-z_$][\w$]*
    // missed `as \u03c3\u03cd\u03bd\u03b4\u03b5\u03c3\u03bc\u03bf\u03c2`, and the name is not the finding: the rename is.
    // KNOWN LIMIT: a comment between the tokens (`symlinkSync /* c */ as x`) and
    // the string-literal export form (`{ 'symlinkSync' as x }`) still slip past.
    const ALIAS = /\bsymlinkSync\s+as\s+/g;
    const scan = (src) => {
      const isCode = codeMask(src);
      return {
        // An alias defeats the scan outright: `import { symlinkSync as linkIt }`
        // then linkIt(join(ROOT, 'node_modules'), ...) matches nothing below.
        // There is no reason to rename this import, so the rename is the finding.
        // EVERY match, not the first: a commented-out alias above a real one
        // would otherwise answer for it and report the file clean.
        aliased: [...src.matchAll(ALIAS)].some((m) => isCodeRange(isCode, m.index, m.index + m[0].length)),
        lines: firstArgOf(src)
          .filter(({ index, arg }) => isCode[index] && arg.includes('node_modules'))
          .map(({ index }) => src.slice(0, index).split('\n').length),
      };
    };

    // Prove the scan can find before trusting it clean -- over the shapes that
    // can defeat it, not one plain call. Each of these is measured against the
    // line-based blanker this replaced, and 3 of the 6 catch it: a `//` in a
    // string hides the rest of its line, a `/*` in a string hides everything to
    // the next `*/`, and a call written inside a string is read as real. The
    // `/*` probe carries a later comment for that reason. Without one the source
    // has no closing `*/`, the old blanker matches nothing, and the probe passes
    // under the very implementation it exists to condemn. The call is built by
    // concatenation, so this suite's own source never carries the pattern its
    // scan forbids.
    const RAW = `symlink${'Sync'}(join(ROOT, 'node_modules'), join(x, 'node_modules'), 'dir');`;
    const probes = [
      ['a bare call', RAW, 1],
      ['a call after a string holding //', `const sep = "//"; ${RAW}`, 1],
      ['a call below a string holding /*', `const open = "/*";\n${RAW}\n/* a later comment */`, 1],
      ['a call in a line comment', `// ${RAW}`, 0],
      ['a call in a block comment', `/* ${RAW} */`, 0],
      ['a call inside a string', `const s = ${JSON.stringify(RAW)};`, 0],
      // Operand-position keywords. A regex is legal straight after these, and a
      // quote inside one opens a phantom string across the lines below when the
      // keyword is missing from startsRegex.
      ['a call below `throw` of a quote-bearing regex', `const f = () => { throw /it's bad/; };\n${RAW}`, 1],
      ['a call below `export default` of one', `export default /it's bad/;\n${RAW}`, 1],
      // ...and the same words reached through a dot, where `/` is division. Every
      // operand-position keyword is also a legal property name.
      // SAME line on purpose. A regex scan stops at the newline, so a call on the
      // line below is never masked and the probe passes either way.
      ['a call after division on .return', `const r = obj.return / 7; ${RAW}`, 1],
      ['a call after division on .default', `const r = obj.default / 7; ${RAW}`, 1],
    ];
    // The alias gate gets its own controls, including the shape that made the
    // first version of it wrong: reading only the FIRST match let a
    // commented-out alias answer for a real one below it.
    const ALIASED = `import { symlink${'Sync'} as linkIt } from 'fs';`;
    const aliasProbes = [
      ['a real aliased import', ALIASED, true],
      ['a real aliased import below a commented one', `// ${ALIASED}\n${ALIASED}`, true],
      ['an aliased import in a comment', `// ${ALIASED}`, false],
      ['an aliased import inside a string', `const s = ${JSON.stringify(ALIASED)};`, false],
      ['an aliased import bound to a non-ASCII name', `import { symlink${'Sync'} as \u03c3\u03cd\u03bd\u03b4\u03b5\u03c3\u03bc\u03bf\u03c2 } from 'fs';`, true],
    ];
    const misread = [
      ...probes.map(([what, src, want]) => [what, scan(src).lines.length, want]),
      ...aliasProbes.map(([what, src, want]) => [what, scan(src).aliased, want]),
    ]
      .filter(([, got, want]) => got !== want)
      .map(([what, got, want]) => `${what}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);

    const tracked = run('git', ['ls-files', 'tests/*.mjs', 'test-all.mjs']).split('\n').filter(Boolean);
    if (tracked.length < 50) {
      fail(`the raw-link scan enumerated only ${tracked.length} tracked files, so a clean result would mean nothing`);
    } else if (misread.length) {
      fail(`the raw-link scan misreads its own controls (${misread.join('; ')}), so it cannot be trusted on the repo`);
    } else {
      const offenders = [];
      const aliased = [];
      for (const rel of tracked) {
        if (rel === 'tests/helpers.mjs') continue; // linkNodeModules lives here; it IS the sanctioned site
        const { aliased: renamed, lines } = scan(readFileSync(join(ROOT, rel), 'utf-8'));
        if (renamed) aliased.push(rel);
        for (const line of lines) offenders.push(`${rel}:${line}`);
      }
      if (aliased.length) {
        fail(`${aliased.join(', ')} imports symlinkSync under another name, which the scan above cannot follow; call it directly or route through linkNodeModules()`);
      } else if (offenders.length) {
        fail(`${offenders.join(', ')} links node_modules with a raw symlinkSync; route it through linkNodeModules() so it gets the Windows junction and the absent-tree reason`);
      } else {
        pass('no tracked test links node_modules outside linkNodeModules()');
      }
    }
  }

} catch (err) {
  fail(`sandbox node_modules link suite crashed: ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
