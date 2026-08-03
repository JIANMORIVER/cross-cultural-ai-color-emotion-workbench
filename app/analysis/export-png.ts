"use client";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_CANVAS_EDGE = 16_000;
const MAX_CANVAS_AREA = 64_000_000;

function copyComputedStyles(source: Element, target: Element) {
  const computed = window.getComputedStyle(source);
  const styledTarget = target as HTMLElement | SVGElement;
  for (const property of computed) {
    styledTarget.style.setProperty(
      property,
      computed.getPropertyValue(property),
      computed.getPropertyPriority(property),
    );
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  sourceChildren.forEach((child, index) => {
    const targetChild = targetChildren[index];
    if (targetChild) copyComputedStyles(child, targetChild);
  });
}

function canvasScale(width: number, height: number, requestedScale = 2) {
  const edgeScale = Math.min(MAX_CANVAS_EDGE / width, MAX_CANVAS_EDGE / height);
  const areaScale = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  return Math.max(1, Math.min(requestedScale, edgeScale, areaScale));
}

function loadSvg(svg: string) {
  return new Promise<{ image: HTMLImageElement; url: string }>((resolve, reject) => {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      reject(new Error("浏览器无法解析图表快照。"));
    };
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器未能生成 PNG 文件。"));
    }, "image/png");
  });
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export type ElementPngOptions = {
  minimumWidth?: number;
  minimumHeight?: number;
  background?: string;
  publicationMode?: boolean;
  scale?: number;
  title?: string;
  subtitle?: string;
  showTitle?: boolean;
  removeSelectors?: string[];
};

function freezeInteractiveControls(clone: HTMLElement) {
  clone.querySelectorAll("button").forEach(button => button.remove());
  clone.querySelectorAll("select").forEach(select => {
    const selected = select.options[select.selectedIndex]?.text || select.value;
    const value = document.createElement("span");
    value.textContent = selected;
    value.setAttribute(
      "style",
      "display:inline-flex;align-items:center;min-height:28px;padding:4px 9px;border:1px solid #cfd8d5;background:#fff;color:#334952;font:600 9px/1.4 sans-serif;",
    );
    select.replaceWith(value);
  });
  clone.querySelectorAll("input").forEach(input => {
    const value = document.createElement("span");
    value.textContent = input.value;
    value.setAttribute(
      "style",
      "display:inline-flex;align-items:center;min-height:28px;padding:4px 9px;border:1px solid #cfd8d5;background:#fff;color:#334952;font:600 9px/1.4 sans-serif;",
    );
    input.replaceWith(value);
  });
}

export async function elementToPngBlob(
  element: HTMLElement,
  options: ElementPngOptions = {},
) {
  if ("fonts" in document) await document.fonts.ready;

  const minimumWidth = options.minimumWidth ?? 900;
  const minimumHeight = options.minimumHeight ?? 520;
  const background = options.background ?? "#f6f7f4";
  const bounds = element.getBoundingClientRect();
  const width = Math.max(minimumWidth, Math.ceil(element.scrollWidth), Math.ceil(bounds.width));
  const titleExtra = options.showTitle !== false && options.title ? 105 : 0;
  const height = Math.max(minimumHeight, Math.ceil(element.scrollHeight) + titleExtra, Math.ceil(bounds.height) + titleExtra);
  const clone = element.cloneNode(true) as HTMLElement;
  copyComputedStyles(element, clone);
  if (options.publicationMode) freezeInteractiveControls(clone);
  options.removeSelectors?.forEach(selector => clone.querySelectorAll(selector).forEach(node => node.remove()));
  if (options.showTitle !== false && options.title) {
    const header = document.createElement("header");
    header.setAttribute(
      "style",
      "margin:0 0 24px;padding:0 0 16px;border-bottom:2px solid #263f49;color:#263f49;font-family:Arial,'Helvetica Neue',sans-serif;",
    );
    const title = document.createElement("h1");
    title.textContent = options.title;
    title.setAttribute("style", "margin:0;font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;");
    header.appendChild(title);
    if (options.subtitle) {
      const subtitle = document.createElement("p");
      subtitle.textContent = options.subtitle;
      subtitle.setAttribute("style", "margin:7px 0 0;color:#687980;font-size:14px;line-height:1.45;");
      header.appendChild(subtitle);
    }
    clone.prepend(header);
  }
  clone.style.width = `${width}px`;
  clone.style.height = "auto";
  clone.style.minHeight = `${height}px`;
  clone.style.margin = "0";
  clone.style.boxSizing = "border-box";
  clone.style.background = background;

  const wrapper = document.createElementNS(XHTML_NAMESPACE, "div");
  wrapper.setAttribute("xmlns", XHTML_NAMESPACE);
  wrapper.setAttribute(
    "style",
    `width:${width}px;min-height:${height}px;background:${background};padding:20px;box-sizing:border-box;`,
  );
  wrapper.appendChild(clone);

  const outputWidth = width + 40;
  const outputHeight = height + 40;
  const serialized = new XMLSerializer().serializeToString(wrapper);
  const svg = `<svg xmlns="${SVG_NAMESPACE}" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
  const { image, url } = await loadSvg(svg);

  try {
    const scale = canvasScale(outputWidth, outputHeight, options.scale ?? 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(outputWidth * scale);
    canvas.height = Math.round(outputHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持画布导出。");
    context.scale(scale, scale);
    context.fillStyle = background;
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    return await canvasToPng(canvas);
  } finally {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

export async function downloadElementPng(
  element: HTMLElement,
  name: string,
  minimumWidth = 900,
  minimumHeight = 520,
) {
  triggerDownload(await elementToPngBlob(element, { minimumWidth, minimumHeight }), name);
}

export async function downloadPublicationPng(
  element: HTMLElement,
  name: string,
  options: Omit<ElementPngOptions, "publicationMode"> = {},
) {
  triggerDownload(await elementToPngBlob(element, {
    minimumWidth: 1_800,
    minimumHeight: 900,
    background: "#ffffff",
    scale: 2,
    ...options,
    publicationMode: true,
  }), name);
}
