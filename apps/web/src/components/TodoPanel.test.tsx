import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarProvider } from "./ui/sidebar";
import { TodoPanel } from "./TodoPanel";

describe("TodoPanel", () => {
  it("renders the Todos header", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <TodoPanel />
      </SidebarProvider>,
    );
    expect(html).toContain("Todos");
  });
});
