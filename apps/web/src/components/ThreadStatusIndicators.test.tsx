import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangeRequestBadge } from "./ThreadStatusIndicators";

const provider: VcsStatusResult["sourceControlProvider"] = {
  kind: "github",
  name: "GitHub",
  baseUrl: "https://github.com",
};

describe("ChangeRequestBadge", () => {
  it("renders bounded open labels with accessible contrast and overflow", () => {
    const markup = renderToStaticMarkup(
      <ChangeRequestBadge
        provider={provider}
        pr={{
          number: 42,
          title: "PR labels",
          url: "https://github.com/acme/repo/pull/42",
          baseRef: "main",
          headRef: "labels",
          state: "open",
          labels: [
            { name: "bug", color: "#d73a4a" },
            { name: "frontend", color: "#a2eeef" },
            { name: "ready" },
          ],
        }}
      />,
    );
    expect(markup).toContain("#42");
    expect(markup).toContain("bug");
    expect(markup).toContain("frontend");
    expect(markup).toContain("+1");
    expect(markup).toContain("color:#ffffff");
    expect(markup).toContain("color:#111827");
    expect(markup).not.toContain(">ready<");
  });

  it("hides labels for non-open change requests", () => {
    const markup = renderToStaticMarkup(
      <ChangeRequestBadge
        provider={provider}
        pr={{
          number: 9,
          title: "Merged",
          url: "https://github.com/acme/repo/pull/9",
          baseRef: "main",
          headRef: "merged",
          state: "merged",
          labels: [{ name: "release", color: "#5319e7" }],
        }}
      />,
    );
    expect(markup).toContain("#9");
    expect(markup).not.toContain("release");
  });
});
