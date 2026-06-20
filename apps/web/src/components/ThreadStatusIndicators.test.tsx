import type { VcsStatusResult } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChangeRequestBadge } from "./ThreadStatusIndicators";

const githubProvider: VcsStatusResult["sourceControlProvider"] = {
  kind: "github",
  name: "GitHub",
  baseUrl: "https://github.com",
};

describe("ChangeRequestBadge", () => {
  it("renders number and open labels with overflow", () => {
    const markup = renderToStaticMarkup(
      <ChangeRequestBadge
        provider={githubProvider}
        pr={{
          number: 42,
          title: "Decorate the change request badge",
          url: "https://github.com/pingdotgg/t3code/pull/42",
          baseRef: "main",
          headRef: "feature/pr-badge",
          state: "open",
          labels: [
            { name: "ready-for-agent", color: "#0e8a16" },
            { name: "enhancement", color: "#a2eeef" },
            { name: "frontend" },
          ],
        }}
      />,
    );

    expect(markup).toContain("#42");
    expect(markup).toContain("ready-for-agent");
    expect(markup).toContain("enhancement");
    expect(markup).toContain("+1");
    expect(markup).toContain("background-color:#0e8a16");
    expect(markup).toContain("background-color:#a2eeef");
    expect(markup).not.toContain("frontend");
  });

  it("renders open change requests without labels compactly when none exist", () => {
    const markup = renderToStaticMarkup(
      <ChangeRequestBadge
        provider={githubProvider}
        pr={{
          number: 7,
          title: "No labels here",
          url: "https://github.com/pingdotgg/t3code/pull/7",
          baseRef: "main",
          headRef: "feature/no-labels",
          state: "open",
        }}
      />,
    );

    expect(markup).toContain("#7");
    expect(markup).not.toContain("+");
  });

  it("deduplicates repeated labels before computing overflow", () => {
    const markup = renderToStaticMarkup(
      <ChangeRequestBadge
        provider={githubProvider}
        pr={{
          number: 17,
          title: "Repeated labels",
          url: "https://github.com/pingdotgg/t3code/pull/17",
          baseRef: "main",
          headRef: "feature/repeated-labels",
          state: "open",
          labels: [
            { name: "bug", color: "#d73a4a" },
            { name: "Bug", color: "#d73a4a" },
            { name: "frontend", color: "#1d76db" },
          ],
        }}
      />,
    );

    expect(markup).toContain("bug");
    expect(markup).not.toContain("+1");
    expect(markup).not.toContain(">Bug<");
  });

  it.each([
    { state: "closed" as const, number: 8, hiddenLabel: "release" },
    { state: "merged" as const, number: 9, hiddenLabel: "shipit" },
  ])(
    "keeps $state change requests compact by hiding labels",
    ({ state, number, hiddenLabel }: { state: "closed" | "merged"; number: number; hiddenLabel: string }) => {
    const markup = renderToStaticMarkup(
      <ChangeRequestBadge
        provider={githubProvider}
        pr={{
          number,
          title: `${state} pull request`,
          url: `https://github.com/pingdotgg/t3code/pull/${number}`,
          baseRef: "main",
          headRef: `feature/${state}`,
          state,
          labels: [{ name: hiddenLabel, color: "#5319e7" }],
        }}
      />,
    );

    expect(markup).toContain(`#${number}`);
    expect(markup).not.toContain(hiddenLabel);
    },
  );
});
