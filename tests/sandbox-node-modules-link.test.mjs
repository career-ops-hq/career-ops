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

    // Worktree layout: the checkout has no node_modules of its own and runs on
    // the one in a parent directory, which is how Node resolves every import
    // made from it. A git worktree under `.claude/worktrees/<name>` is exactly
    // this, and "not installed" was the wrong answer there: the suites that
    // skip on the reason went quiet, and the one that throws on it failed,
    // while the code under test resolved its packages without trouble.
    {
      // One base directory per case, so no case can resolve another's tree.
      // `installed` goes in the nearer ancestor (the main checkout), `far` in
      // one above it; an entry is a name, or { name, main, dependencies } for a
      // package a test actually imports.
      const install = (dir, entry, from) => {
        const spec = typeof entry === 'string' ? { name: entry } : entry;
        const at = join(dir, 'node_modules', spec.name);
        mkdirSync(at, { recursive: true });
        writeFileSync(join(at, 'package.json'), JSON.stringify({
          name: spec.name, from, type: 'module', exports: './index.js',
          dependencies: spec.dependencies ?? {}, peerDependencies: spec.peerDependencies ?? {},
        }), 'utf-8');
        writeFileSync(join(at, 'index.js'), spec.main ?? `export default ${JSON.stringify(from)};`, 'utf-8');
      };
      const layout = (name, { installed = [], far = [], declared = null, own = null } = {}) => {
        const base = join(tmp, name);
        const parent = join(base, 'main');
        const root = join(parent, 'worktrees', 'wt');
        mkdirSync(root, { recursive: true });
        for (const pkg of installed) install(parent, pkg, 'near');
        for (const pkg of far) install(base, pkg, 'far');
        if (declared) {
          writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(declared.map((d) => [d, '*'])) }), 'utf-8');
        }
        if (own) own(root);
        const sandbox = join(tmp, `sandbox-${name}`);
        mkdirSync(sandbox, { recursive: true });
        return { parent, root, sandbox };
      };
      const entryOf = (sandbox) => {
        try { lstatSync(join(sandbox, 'node_modules')); return 'present'; } catch (err) { return err.code; }
      };
      const manifestOf = (sandbox, pkg) => JSON.parse(readFileSync(join(sandbox, 'node_modules', pkg, 'package.json'), 'utf-8'));
      const through = (sandbox, pkg) => {
        try { return manifestOf(sandbox, pkg).name; } catch (err) { return `unreadable: ${err.code}`; }
      };
      const originOf = (sandbox, pkg) => {
        try { return manifestOf(sandbox, pkg).from; } catch (err) { return `unreadable: ${err.code}`; }
      };
      // What a script copied into the sandbox gets when it imports the package.
      // One probe file per package: a module URL is imported once per process,
      // so a shared probe would answer the second question with the first result.
      const importFrom = async (sandbox, pkg) => {
        const probe = join(sandbox, `probe-${pkg.replace(/[^a-z0-9-]/gi, '_')}.mjs`);
        writeFileSync(probe, `export { default } from ${JSON.stringify(pkg)};`, 'utf-8');
        try { return (await import(pathToFileURL(probe).href)).default; } catch (err) { return `import failed: ${err.code ?? err.message}`; }
      };

      {
        const { root, sandbox } = layout('wt-inherits', { installed: ['demo-pkg'], declared: ['demo-pkg'] });
        const reason = linkNodeModules(sandbox, root);
        if (reason === null && through(sandbox, 'demo-pkg') === 'demo-pkg') {
          pass('a checkout with no node_modules of its own links the tree it inherits from a parent directory');
        } else {
          fail(`worktree layout: reason=${JSON.stringify(reason)}, read through the link: ${JSON.stringify(through(sandbox, 'demo-pkg'))}`);
        }
      }

      // The link must be the node_modules directory, not the scope directory a
      // scoped package sits one level further down in.
      {
        const { root, sandbox } = layout('wt-scoped', { installed: ['@demo/scoped'], declared: ['@demo/scoped'] });
        const reason = linkNodeModules(sandbox, root);
        if (reason === null && through(sandbox, '@demo/scoped') === '@demo/scoped') {
          pass('a scoped dependency still resolves to the node_modules directory, not to its scope folder');
        } else {
          fail(`scoped worktree layout: reason=${JSON.stringify(reason)}, read through the link: ${JSON.stringify(through(sandbox, '@demo/scoped'))}`);
        }
      }

      // Dependencies in TWO ancestor trees. Node resolves each specifier on its
      // own, so one package can come from the main checkout and another from a
      // directory above it. One link to the nearer tree made the first loadable
      // and the second not, while the worktree itself loaded both.
      {
        const { root, sandbox } = layout('wt-two-trees', { installed: ['near-pkg'], far: ['far-pkg'], declared: ['near-pkg', 'far-pkg'] });
        const reason = linkNodeModules(sandbox, root);
        const got = [await importFrom(sandbox, 'near-pkg'), await importFrom(sandbox, 'far-pkg')];
        if (reason === null && got[0] === 'near' && got[1] === 'far') {
          pass('dependencies spread over two ancestor trees are both importable from the sandbox');
        } else {
          fail(`two ancestor trees: reason=${JSON.stringify(reason)}, imports=${JSON.stringify(got)}`);
        }
      }

      // The same package in both trees: the nearer one is what Node gives the
      // worktree, so it is what the sandbox must get.
      {
        const { root, sandbox } = layout('wt-nearer-wins', { installed: ['demo-pkg'], far: ['demo-pkg'], declared: ['demo-pkg'] });
        const reason = linkNodeModules(sandbox, root);
        if (reason === null && originOf(sandbox, 'demo-pkg') === 'near') {
          pass('a package installed in two ancestor trees is taken from the nearer one');
        } else {
          fail(`nearer wins: reason=${JSON.stringify(reason)}, linked from ${JSON.stringify(originOf(sandbox, 'demo-pkg'))}`);
        }
      }

      // One declared dependency missing everywhere does not cost the sandbox the
      // ones that are installed: the worktree's own scripts are in the same state.
      {
        const { root, sandbox } = layout('wt-partial', { installed: ['demo-pkg'], declared: ['demo-pkg', 'never-installed-pkg'] });
        const reason = linkNodeModules(sandbox, root);
        if (reason === null && through(sandbox, 'demo-pkg') === 'demo-pkg' && through(sandbox, 'never-installed-pkg') === 'unreadable: ENOENT') {
          pass('the installed dependencies are linked when another declared one is installed nowhere');
        } else {
          fail(`partial install: reason=${JSON.stringify(reason)}, demo-pkg=${JSON.stringify(through(sandbox, 'demo-pkg'))}`);
        }
      }

      // A linked package keeps loading its OWN dependencies, which the checkout
      // does not declare and the sandbox does not link: Node resolves them from
      // the package's real location.
      const withDependency = {
        installed: [
          { name: 'demo-dep', main: "export default 'from the dependency';" },
          { name: 'demo-pkg', main: "import dep from 'demo-dep'; export default dep;", dependencies: { 'demo-dep': '*' } },
        ],
        declared: ['demo-pkg'],
      };
      {
        const { root, sandbox } = layout('wt-transitive-link', withDependency);
        const reason = linkNodeModules(sandbox, root);
        const got = await importFrom(sandbox, 'demo-pkg');
        if (reason === null && got === 'from the dependency' && through(sandbox, 'demo-dep') === 'unreadable: ENOENT') {
          pass('a linked package resolves its own dependency without that dependency being linked');
        } else {
          fail(`transitive (link): reason=${JSON.stringify(reason)}, import=${JSON.stringify(got)}`);
        }
      }

      // The copy path, forced. Where no link can be made the package is copied,
      // and a copy resolves from the sandbox, where its dependency is not. The
      // dependency has to come with it.
      {
        const { root, sandbox } = layout('wt-transitive-copy', withDependency);
        let attempts = 0;
        const refuse = () => { attempts++; throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' }); };
        const reason = linkNodeModules(sandbox, root, { link: refuse });
        const got = await importFrom(sandbox, 'demo-pkg');
        const copied = lstatSync(join(sandbox, 'node_modules', 'demo-pkg'));
        if (reason === null && attempts === 1 && copied.isDirectory() && !copied.isSymbolicLink() && got === 'from the dependency') {
          pass('when linking is refused, the copied package still loads its own dependency');
        } else {
          fail(`transitive (copy): reason=${JSON.stringify(reason)}, link attempts=${attempts}, symlink=${copied.isSymbolicLink()}, import=${JSON.stringify(got)}`);
        }
      }

      // The same, for a PEER dependency. A package imports its peer like any
      // other, and the peer is installed beside it rather than declared under
      // `dependencies`, so a copy that follows only `dependencies` loses it.
      {
        const { root, sandbox } = layout('wt-peer-copy', {
          installed: [
            { name: 'demo-peer', main: "export default 'from the peer';" },
            { name: 'demo-pkg', main: "import peer from 'demo-peer'; export default peer;", peerDependencies: { 'demo-peer': '*' } },
          ],
          declared: ['demo-pkg'],
        });
        const refuse = () => { throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' }); };
        const reason = linkNodeModules(sandbox, root, { link: refuse });
        const got = await importFrom(sandbox, 'demo-pkg');
        if (reason === null && got === 'from the peer') {
          pass('when linking is refused, the copied package still loads an installed peer dependency');
        } else {
          fail(`peer (copy): reason=${JSON.stringify(reason)}, import=${JSON.stringify(got)}`);
        }
      }

      // A package.json that is there and cannot be used is not "dependencies not
      // installed": `npm ci` is the wrong advice for a manifest that does not
      // parse, and following it would change nothing.
      {
        const { root, sandbox } = layout('wt-bad-manifest', { installed: ['demo-pkg'] });
        writeFileSync(join(root, 'package.json'), '{ "dependencies": { "demo-pkg": ', 'utf-8');
        const reason = linkNodeModules(sandbox, root);
        if (typeof reason === 'string' && /package\.json/.test(reason) && /not valid JSON/.test(reason) && !/npm ci/.test(reason) && entryOf(sandbox) === 'ENOENT') {
          pass('an unparseable package.json is reported as that, not as missing dependencies');
        } else {
          fail(`unparseable manifest: reason=${JSON.stringify(reason)}, lstat: ${entryOf(sandbox)}`);
        }
      }
      {
        const { root, sandbox } = layout('wt-manifest-is-dir', { installed: ['demo-pkg'] });
        mkdirSync(join(root, 'package.json'));
        const reason = linkNodeModules(sandbox, root);
        if (typeof reason === 'string' && /package\.json/.test(reason) && /unreadable \(E[A-Z]+\)/.test(reason) && !/npm ci/.test(reason) && entryOf(sandbox) === 'ENOENT') {
          pass('a package.json that cannot be read is reported with its errno, not as missing dependencies');
        } else {
          fail(`unreadable manifest: reason=${JSON.stringify(reason)}, lstat: ${entryOf(sandbox)}`);
        }
      }

      // A node_modules above the checkout that holds none of its dependencies is
      // somebody else's (a stray ~/node_modules above a fresh clone). Linking it
      // would trade an honest skip for ERR_MODULE_NOT_FOUND inside the sandbox.
      {
        const { root, sandbox } = layout('wt-stray', { installed: ['unrelated'], declared: ['demo-pkg'] });
        const reason = linkNodeModules(sandbox, root);
        if (typeof reason === 'string' && /npm ci/.test(reason) && reason.includes(root) && entryOf(sandbox) === 'ENOENT') {
          pass('an ancestor node_modules holding none of the declared dependencies is not linked');
        } else {
          fail(`stray ancestor tree: reason=${JSON.stringify(reason)}, lstat: ${entryOf(sandbox)}`);
        }
      }

      // With nothing declared there is nothing to recognize a tree by, so a root
      // that is not a checkout (a fixture directory) cannot claim one.
      {
        const { root, sandbox } = layout('wt-undeclared', { installed: ['demo-pkg'] });
        const reason = linkNodeModules(sandbox, root);
        if (typeof reason === 'string' && entryOf(sandbox) === 'ENOENT') {
          pass('a root with no package.json does not inherit a tree from a parent directory');
        } else {
          fail(`undeclared root: reason=${JSON.stringify(reason)}, lstat: ${entryOf(sandbox)}`);
        }
      }

      // The checkout's own tree wins, as it does for Node.
      {
        const { root, sandbox } = layout('wt-own-first', {
          installed: ['demo-pkg'],
          declared: ['demo-pkg'],
          own: (r) => {
            mkdirSync(join(r, 'node_modules', 'demo-pkg'), { recursive: true });
            writeFileSync(join(r, 'node_modules', 'demo-pkg', 'package.json'), JSON.stringify({ name: 'own-copy' }), 'utf-8');
          },
        });
        const reason = linkNodeModules(sandbox, root);
        if (reason === null && through(sandbox, 'demo-pkg') === 'own-copy') {
          pass('a checkout with its own node_modules links that one, not a parent directory\'s');
        } else {
          fail(`own tree first: reason=${JSON.stringify(reason)}, read through the link: ${JSON.stringify(through(sandbox, 'demo-pkg'))}`);
        }
      }

      // An own tree that is there and unusable is reported as itself. Falling
      // back to the parent's would hide a broken checkout behind a working one.
      {
        const { root, sandbox } = layout('wt-own-broken', {
          installed: ['demo-pkg'],
          declared: ['demo-pkg'],
          // Windows without the symlink privilege cannot make the loop; the row
          // below notices the missing entry and says it was skipped.
          own: (r) => {
            const loop = join(r, 'node_modules');
            try { symlinkSync(loop, loop); } catch { /* reported below */ }
          },
        });
        let made = true;
        try { lstatSync(join(root, 'node_modules')); } catch { made = false; }
        if (!made) {
          warn('skipped the broken-own-tree row: a self-referential symlink could not be created here');
        } else {
          const reason = linkNodeModules(sandbox, root);
          if (typeof reason === 'string' && /unreadable \(ELOOP\)/.test(reason) && entryOf(sandbox) === 'ENOENT') {
            pass('an unusable own node_modules is reported, not replaced by a parent directory\'s tree');
          } else {
            fail(`broken own tree: reason=${JSON.stringify(reason)}, lstat: ${entryOf(sandbox)}`);
          }
        }
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
    // A statement STARTS where the previous significant character closes one, so
    // a linkNodeModules() call reached that way is an expression statement and
    // its reason went nowhere. Non-code positions are stepped over with the rest
    // of the whitespace, or a comment on the line above would answer for it.
    const isBareStatement = (src, isCode, at) => {
      let i = at - 1;
      while (i >= 0 && (/\s/.test(src[i]) || !isCode[i])) i--;
      return i < 0 || src[i] === ';' || src[i] === '{' || src[i] === '}';
    };
    const scan = (src) => {
      const isCode = codeMask(src);
      return {
        // The reason is the whole point of the helper. Dropping it puts the call
        // site back where the raw symlinkSync sites were: a sandbox with no
        // dependency tree, and assertions that report on a run that never
        // happened. Checked at EVERY call site rather than at the one in
        // test-all.mjs, which is the enumeration this section exists to replace.
        bareCalls: [...src.matchAll(/\blinkNodeModules\s*\(/g)]
          .filter((m) => isCode[m.index] && isBareStatement(src, isCode, m.index))
          .map((m) => src.slice(0, m.index).split('\n').length),
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
    const LNM = `link${'NodeModules'}(codeRoot, ROOT)`;
    const bareProbes = [
      ['a discarded result', `${LNM};`, 1],
      ['a discarded result below a comment', `// note\n${LNM};`, 1],
      ['a discarded result after a block', `if (x) { y(); }\n${LNM};`, 1],
      ['a bound result', `const reason = ${LNM};`, 0],
      ['a returned result', `const f = () => { return ${LNM}; };`, 0],
      ['a tested result', `if (${LNM}) { skip(); }`, 0],
      ['a call in a comment', `// ${LNM};`, 0],
      ['a call inside a string', `const s = ${JSON.stringify(LNM + ';')};`, 0],
    ];
    const misread = [
      ...probes.map(([what, src, want]) => [what, scan(src).lines.length, want]),
      ...aliasProbes.map(([what, src, want]) => [what, scan(src).aliased, want]),
      ...bareProbes.map(([what, src, want]) => [what, scan(src).bareCalls.length, want]),
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
      const discarded = [];
      for (const rel of tracked) {
        if (rel === 'tests/helpers.mjs') continue; // linkNodeModules lives here; it IS the sanctioned site
        const { aliased: renamed, lines, bareCalls } = scan(readFileSync(join(ROOT, rel), 'utf-8'));
        if (renamed) aliased.push(rel);
        for (const line of lines) offenders.push(`${rel}:${line}`);
        for (const line of bareCalls) discarded.push(`${rel}:${line}`);
      }
      if (discarded.length) {
        fail(`${discarded.join(', ')} throws away the reason linkNodeModules() returns, so an absent tree cannot make it skip`);
      } else if (aliased.length) {
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
