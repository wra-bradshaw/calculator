# Calculator

A Desmos-scientific-style CAS calculator. Type math with [MathLive](https://mathlive.io) and see answers instantly, computed by the [Compute Engine](https://mathlive.io/compute-engine/).

```sh
pnpm install
pnpm dev      # http://localhost:4317
pnpm test
pnpm build    # static SPA in dist/client (serve _shell.html for all routes)
```

## What it does

- **Rows evaluate live**, showing an exact answer and a decimal approximation.
- **Variables and functions** (`a=3`, `f(x)=x^2+a`) can be used from any row, in any order.
- **Equations** are solved for `x` (or their only unknown); `cases` systems are solved for all unknowns.
- **Calculus**: derivatives, integrals, limits, sums and products, Taylor series (`Series`).
- **Linear algebra**: matrix arithmetic, `\det`, inverse, transpose, eigenvalues, `Cross`.
- **Settings**: degrees or radians, and the number of digits shown.

## Out of scope

Graphing, matrix exponentials and other matrix functions (`e^M` is applied entry by entry), numeric root-finding for transcendental equations, ODEs beyond the simple cases `DSolve` handles, step-by-step working, and sharing or accounts.

## How it works

- `src/engine/latex.ts` classifies each row (definition, function or expression). It rewrites `a(b+1)` as multiplication unless `a` is a user-defined function.
- `src/engine/sheet.ts` evaluates a sheet. It builds a dependency graph of definitions and evaluates them in topological order in a fresh `ComputeEngine`. Rows whose inputs haven't changed are reused from a cache.
- `src/engine/client.ts` runs the evaluation in a Web Worker. The engine can't be interrupted, so a row running longer than 5 s is stopped by terminating the worker; the sheet is then re-run with that row skipped.
