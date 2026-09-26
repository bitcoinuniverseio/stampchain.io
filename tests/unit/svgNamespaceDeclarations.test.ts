import { svgNamespaceDeclarations } from "$lib/utils/ui/rendering/svgUtils.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "jsr:@std/testing@1.0.14/bdd";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.0";

// A 2x2 red PNG, layered the way SRC-721 stamps are composed.
const LAYER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=";
const SRC721 = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
        viewBox="0 0 420 420">
    <image x="0" y="0" width="420" height="420" xlink:href="${LAYER}"/></svg>`;

describe("svgNamespaceDeclarations", () => {
  it("always declares xlink", () => {
    assertEquals(
      svgNamespaceDeclarations('<svg xmlns="http://www.w3.org/2000/svg">'),
      ' xmlns:xlink="http://www.w3.org/1999/xlink"',
    );
  });

  it("carries over the root's own prefixes once each", () => {
    const decls = svgNamespaceDeclarations(
      `<svg xmlns:xlink='http://www.w3.org/1999/xlink' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">`,
    );
    assertEquals(decls.match(/xmlns:xlink=/g)?.length, 1);
    assertStringIncludes(
      decls,
      'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"',
    );
  });

  it("lets resvg render a rewrapped SRC-721 stamp", async () => {
    await initWasm(
      fetch("https://unpkg.com/@resvg/resvg-wasm@2.6.0/index_bg.wasm"),
    );
    // Same shape as the preview route's wrapper: the stamp's root <svg> is
    // stripped and replaced, so its declarations must move to the wrapper.
    const wrapped =
      `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"${
        svgNamespaceDeclarations(SRC721)
      }><svg width="100" height="100" viewBox="0 0 420 420">${
        SRC721.replace(/<\/?svg[^>]*>/g, "")
      }</svg></svg>`;
    const rendered = new Resvg(wrapped, { fitTo: { mode: "width", value: 100 } })
      .render();
    const pixels = rendered.pixels;
    // Centre pixel is the red layer, not transparent.
    const i = (50 * 100 + 50) * 4;
    assertEquals([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]], [
      255,
      0,
      0,
      255,
    ]);
  });
});
