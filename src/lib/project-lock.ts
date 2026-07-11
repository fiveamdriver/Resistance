/**
 * Per-project async mutex for connectivity writers.
 *
 * The netlist/board write layer reads existing rows, diffs in memory, then
 * createMany's the missing ones. Two writers racing on the same project (a
 * "Sync now" click while an aborted sync is still running server-side, the
 * auto-sync watcher overlapping a manual sync, an upload during a sync) both
 * see a component as missing and both create it — the second dies on the
 * (projectId, refDes) unique constraint. Serializing writers per project
 * removes the race at its root; different projects stay concurrent.
 *
 * In-process only, which is sufficient: every write path (routes, MCP sync)
 * runs inside the single Next server process.
 */

const tails = new Map<string, Promise<void>>();

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = tails.get(projectId) ?? Promise.resolve();
  // Run after the previous holder settles, success or failure alike.
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  tails.set(projectId, tail);
  try {
    return await run;
  } finally {
    if (tails.get(projectId) === tail) tails.delete(projectId);
  }
}
