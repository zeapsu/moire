import { describe, expect, it, vi } from "vitest";
import { promoteArtifactTask, runArtifactTask } from "@/lib/artifact";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("artifact queue priority", () => {
  it("starts an interactive request before queued speculative work", async () => {
    const first = deferred();
    const second = deferred();
    const interactive = deferred();
    const prefetch = deferred();
    const started: string[] = [];

    const activeOne = runArtifactTask(() => {
      started.push("active-one");
      return first.promise;
    });
    const activeTwo = runArtifactTask(() => {
      started.push("active-two");
      return second.promise;
    });
    const queuedPrefetch = runArtifactTask(() => {
      started.push("prefetch");
      return prefetch.promise;
    }, "prefetch");
    const queuedInteractive = runArtifactTask(() => {
      started.push("interactive");
      return interactive.promise;
    }, "interactive");

    expect(started).toEqual(["active-one", "active-two"]);
    first.resolve();
    await vi.waitFor(() => expect(started).toEqual(["active-one", "active-two", "interactive"]));

    interactive.resolve();
    await vi.waitFor(() => expect(started).toEqual(["active-one", "active-two", "interactive", "prefetch"]));
    second.resolve();
    prefetch.resolve();
    await Promise.all([activeOne, activeTwo, queuedInteractive, queuedPrefetch]);
  });

  it("promotes a clicked speculative task ahead of older queued prefetches", async () => {
    const first = deferred();
    const second = deferred();
    const older = deferred();
    const clicked = deferred();
    const started: string[] = [];

    const activeOne = runArtifactTask(() => {
      started.push("active-one");
      return first.promise;
    });
    const activeTwo = runArtifactTask(() => {
      started.push("active-two");
      return second.promise;
    });
    const olderPrefetch = runArtifactTask(() => {
      started.push("older");
      return older.promise;
    }, "prefetch", "older");
    const clickedPrefetch = runArtifactTask(() => {
      started.push("clicked");
      return clicked.promise;
    }, "prefetch", "clicked");

    expect(promoteArtifactTask("clicked")).toBe(true);
    first.resolve();
    await vi.waitFor(() => expect(started).toEqual(["active-one", "active-two", "clicked"]));

    clicked.resolve();
    await vi.waitFor(() => expect(started).toEqual(["active-one", "active-two", "clicked", "older"]));
    second.resolve();
    older.resolve();
    await Promise.all([activeOne, activeTwo, olderPrefetch, clickedPrefetch]);
  });
});
