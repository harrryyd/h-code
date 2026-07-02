import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";

import { AnnotatableCodeView } from "./AnnotatableCodeView";

const codeViewCapture = vi.hoisted(() => ({
  props: undefined as
    | {
        options?: {
          onGutterUtilityClick?: (...args: unknown[]) => unknown;
        };
      }
    | undefined,
}));

vi.mock("@pierre/diffs/react", () => ({
  CodeView: (props: typeof codeViewCapture.props) => {
    codeViewCapture.props = props;
    return <div data-testid="code-view" />;
  },
}));

function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

describe("AnnotatableCodeView", () => {
  beforeEach(() => {
    codeViewCapture.props = undefined;
    resetComposerDraftStore();
  });

  it("registers the gutter utility callback required to activate the add-comment button", () => {
    const fileDiff = parsePatchFiles(
      [
        "diff --git a/example.txt b/example.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/example.txt",
        "@@ -0,0 +1 @@",
        "+42",
      ].join("\n"),
      "annotatable-code-view-gutter",
    )[0]!.files[0]!;

    renderToStaticMarkup(
      <AnnotatableCodeView
        files={[
          {
            fileDiff,
            filePath: "example.txt",
            fileKey: "example.txt",
            collapsed: false,
          },
        ]}
        sectionId="latest-turn"
        sectionTitle="Latest turn"
        composerDraftTarget={DraftId.make("draft-1")}
        options={{}}
        renderHeaderPrefix={() => null}
      />,
    );

    expect(codeViewCapture.props?.options?.onGutterUtilityClick).toBeTypeOf("function");
  });
});
