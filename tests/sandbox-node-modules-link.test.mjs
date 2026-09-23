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
import { pass, fail, stripJsComments, ROOT } from './helpers.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, lstatSync, symlinkSync, readlinkSync } from 'fs';
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
      const guard = bound && new RegExp(`\\bif\\s*\\(\\s*${bound[1].replace(/\$/g, '\\$')}\\b`);
      if (!bound) {
        fail('test-all.mjs calls linkNodeModules() without binding the reason, so it cannot skip on one');
      } else if (guard.test(callSite)) {
        pass('test-all.mjs branches on the reason linkNodeModules returns');
      } else {
        fail(`test-all.mjs binds linkNodeModules() to ${bound[1]} and never branches on it; an absent tree would sandbox dangling again`);
      }
    }
  }
} catch (err) {
  fail(`sandbox node_modules link suite crashed: ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
