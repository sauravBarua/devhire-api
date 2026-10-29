// Husky is only useful on a developer machine. In CI and production installs (Docker) it is skipped,
// so a pruned install without devDependencies never fails on a missing "husky" binary.
if (process.env.NODE_ENV === 'production' || process.env.CI === 'true')
  process.exit(0);
const husky = (await import('husky')).default;
console.log(husky());
