/* eslint-disable no-console */
import { Flags, Right, Rights, Role, Subject } from './src/index';

console.log('--- Performance Benchmarks ---');

const runBenchmarks = () => {
  // 1. Path Matching Performance
  const rights = new Rights();
  for (let i = 0; i < 100; i++) {
    rights.add(new Right(`/path/${i}/**`, { allow: [Flags.READ] }));
    rights.add(new Right(`/other/${i}/*`, { allow: [Flags.WRITE] }));
  }

  let start = performance.now();
  let iterations = 20_000;
  for (let i = 0; i < iterations; i++) {
    rights.has(`/path/${i % 100}/some/long/sub/path`, Flags.READ);
    rights.has(`/other/${i % 100}/file`, Flags.WRITE);
  }
  let end = performance.now();
  console.log(
    `Path Matching: ${iterations * 2} checks in ${(end - start).toFixed(2)}ms (${(((end - start) / (iterations * 2)) * 1000).toFixed(2)}µs per check)`
  );

  // 2. Subject Aggregation Performance
  const roles = [];
  for (let i = 0; i < 50; i++) {
    const r = new Role(
      `role_${i}`,
      new Rights().allow(`/role/${i}/**`, Flags.ALL)
    );
    roles.push(r);
  }

  const sub = new Subject();
  for (const r of roles) {
    sub.memberOf(r);
  }

  start = performance.now();
  iterations = 10_000;
  for (let i = 0; i < iterations; i++) {
    sub.has(`/role/${i % 50}/anything`, Flags.READ);
  }
  end = performance.now();
  console.log(
    `Subject (50 roles): ${iterations} checks in ${(end - start).toFixed(2)}ms (${(((end - start) / iterations) * 1000).toFixed(2)}µs per check)`
  );
};

runBenchmarks();
