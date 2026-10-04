import {
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ImagePlus,
  Italic,
  Link2,
  RemoveFormatting,
  Underline,
  Unlink,
} from "lucide-react";
import { AppButton } from "./AppButton";
import { AppInput } from "./AppField";
import { appToast } from "./AppToast";
import "./AppRichTextEditor.css";

type RichTextEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  maxImageSizeMb?: number;
};

type SelectionPosition = {
  path: number[];
  offset: number;
};

type SelectionSnapshot = {
  start: SelectionPosition;
  end: SelectionPosition;
};

const FONT_OPTIONS = [
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Verdana", label: "Verdana" },
  { value: "Tahoma", label: "Tahoma" },
  { value: "Trebuchet MS", label: "Trebuchet MS" },
];

const FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20, 24, 32];

const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "EM",
  "FONT",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "I",
  "IMG",
  "LI",
  "OL",
  "P",
  "S",
  "SPAN",
  "STRIKE",
  "STRONG",
  "U",
  "UL",
]);

const LEGACY_FONT_SIZES: Record<string, string> = {
  "1": "12px",
  "2": "14px",
  "3": "16px",
  "4": "18px",
  "5": "20px",
  "6": "24px",
  "7": "32px",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return entities[character];
  });
}

function decodePlainTextEntities(value: string) {
  const normalized = value.replace(
    /&(?:amp;)+(nbsp;|amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/gi,
    "&$1",
  );
  if (typeof document === "undefined") return normalized;
  const decoder = document.createElement("textarea");
  decoder.innerHTML = normalized;
  return decoder.value;
}

function plainTextToHtml(value: string) {
  const text = decodePlainTextEntities(value);
  return `<span>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</span>`;
}

function isRichTextHtml(value: string) {
  return /<\/?(?:a|b|blockquote|br|div|em|font|h[1-6]|i|img|li|ol|p|s|span|strong|strike|u|ul)\b/i.test(
    value,
  );
}

function normalizeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return trimmed;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function normalizeImageSrc(value: string) {
  const trimmed = value.trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function normalizeImageWidth(value: string) {
  const match = value.match(/(?:^|;)\s*width\s*:\s*(\d{1,3}(?:\.\d+)?)%\s*(?:;|$)/i);
  if (!match) return null;
  const width = Number(match[1]);
  return Number.isFinite(width) && width >= 10 && width <= 100 ? `${width}%` : null;
}

function normalizeFont(value: string) {
  const found = FONT_OPTIONS.find(
    (option) => option.value.toLowerCase() === value.trim().replace(/["']/g, "").toLowerCase(),
  );
  return found?.value ?? null;
}

function sanitizeStyle(value: string) {
  const styles = new Map<string, string>();
  value.split(";").forEach((part) => {
    const [rawName, ...rawValue] = part.split(":");
    const name = rawName?.trim().toLowerCase();
    const styleValue = rawValue.join(":").trim();
    if (!name || !styleValue) return;

    if (name === "font-family") {
      const font = normalizeFont(styleValue.replace(/["']/g, ""));
      if (font) styles.set(name, `"${font}"`);
      return;
    }
    if (name === "font-size" && /^(?:[1-9]\d?(?:\.\d+)?)(?:px|pt|em|rem|%)$/i.test(styleValue)) {
      styles.set(name, styleValue);
      return;
    }
    if (name === "font-weight" && /^(?:normal|bold|[1-9]00)$/i.test(styleValue)) {
      styles.set(name, styleValue);
      return;
    }
    if (name === "font-style" && /^(?:normal|italic)$/i.test(styleValue)) {
      styles.set(name, styleValue);
      return;
    }
    if (
      name === "text-decoration" &&
      /^(?:none|underline|line-through|underline line-through)$/i.test(styleValue)
    ) {
      styles.set(name, styleValue);
      return;
    }
    if (name === "text-align" && /^(?:left|center|right|justify)$/i.test(styleValue)) {
      styles.set(name, styleValue);
    }
  });
  return Array.from(styles, ([name, styleValue]) => `${name}: ${styleValue}`).join("; ");
}

/** Keeps persisted rich text safe before previewing it with dangerouslySetInnerHTML. */
export function sanitizeRichTextHtml(value: string | null | undefined) {
  if (!value?.trim()) return "";
  if (typeof DOMParser === "undefined") return value;
  if (!isRichTextHtml(value)) return plainTextToHtml(value);

  const documentFragment = new DOMParser().parseFromString(value, "text/html");
  const cleanElement = (element: Element) => {
    Array.from(element.children).forEach(cleanElement);
    const tagName = element.tagName;
    if (!ALLOWED_TAGS.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    const sourceStyle = element.getAttribute("style") ?? "";
    const sourceHref = element.getAttribute("href") ?? "";
    const sourceImageSrc = element.getAttribute("src") ?? "";
    const sourceImageAlt = element.getAttribute("alt") ?? "";
    const legacyFont =
      tagName === "FONT" ? normalizeFont(element.getAttribute("face") ?? "") : null;
    const legacySize =
      tagName === "FONT" ? LEGACY_FONT_SIZES[element.getAttribute("size") ?? ""] : null;
    const textAlignment = element.getAttribute("align");
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));

    if (tagName === "A") {
      const href = normalizeHref(sourceHref);
      if (!href) {
        element.replaceWith(...Array.from(element.childNodes));
        return;
      }
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
      return;
    }

    if (tagName === "IMG") {
      const src = normalizeImageSrc(sourceImageSrc);
      if (!src) {
        element.remove();
        return;
      }
      element.setAttribute("src", src);
      const alt = sourceImageAlt.slice(0, 240);
      if (alt) element.setAttribute("alt", alt);
      const width = normalizeImageWidth(sourceStyle);
      if (width) element.setAttribute("style", `width: ${width}`);
      return;
    }

    const styles = [sanitizeStyle(sourceStyle)];
    if (legacyFont) styles.push(`font-family: "${legacyFont}"`);
    if (legacySize) styles.push(`font-size: ${legacySize}`);
    if (textAlignment && /^(?:left|center|right|justify)$/i.test(textAlignment)) {
      styles.push(`text-align: ${textAlignment}`);
    }
    const style = sanitizeStyle(styles.filter(Boolean).join("; "));
    if (style) element.setAttribute("style", style);
  };

  Array.from(documentFragment.body.children).forEach(cleanElement);
  return documentFragment.body.innerHTML;
}

export function RichTextPreview({
  value,
  className = "",
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const html = sanitizeRichTextHtml(value);
  if (!html) return null;
  return (
    <div
      className={`app-rich-text-preview ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function isEditorEmpty(element: HTMLDivElement) {
  return !element.querySelector("img") && !element.textContent?.replace(/\u200B/g, "").trim();
}

function selectionFontSize(editor: HTMLDivElement | null, selection: Selection | null) {
  if (!editor || !selection?.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return "";
  const element =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  if (!element) return "";
  const size = Number.parseFloat(window.getComputedStyle(element).fontSize);
  return Number.isFinite(size) ? String(Math.round(size * 100) / 100) : "";
}

function nodePath(root: Node, node: Node) {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) return null;
    const index = Array.from(parent.childNodes).indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function nodeFromPath(root: Node, path: number[]) {
  let node: Node | null = root;
  for (const index of path) {
    node = node?.childNodes[index] ?? null;
    if (!node) return null;
  }
  return node;
}

function positionFromNode(root: Node, node: Node, offset: number): SelectionPosition | null {
  const path = nodePath(root, node);
  return path ? { path, offset } : null;
}

function selectionSnapshot(root: Node, range: Range): SelectionSnapshot | null {
  const start = positionFromNode(root, range.startContainer, range.startOffset);
  const end = positionFromNode(root, range.endContainer, range.endOffset);
  return start && end ? { start, end } : null;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function AppRichTextEditor({
  value,
  onValueChange,
  label,
  hint,
  error,
  required,
  placeholder = "Введите текст…",
  disabled = false,
  className = "",
  maxImageSizeMb = 5,
}: RichTextEditorProps) {
  const generatedId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fontSizeInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const selectionSnapshotRef = useRef<SelectionSnapshot | null>(null);
  const isEditorFocusedRef = useRef(false);
  const latestValueRef = useRef(value);
  latestValueRef.current = value;
  const [editorEmpty, setEditorEmpty] = useState(() => !value.trim());
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const [selectedImageSize, setSelectedImageSize] = useState("AUTO");
  const [imageSizeInput, setImageSizeInput] = useState("");
  const [selectedImageBounds, setSelectedImageBounds] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  });
  const [activeAlignment, setActiveAlignment] = useState<
    "left" | "center" | "right" | "justify" | null
  >(null);
  const [fontSizeInput, setFontSizeInput] = useState("");
  const imageResizeRef = useRef<{
    image: HTMLImageElement;
    startX: number;
    startWidth: number;
    editorWidth: number;
  } | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (isEditorFocusedRef.current) return;
    const normalizedValue = sanitizeRichTextHtml(value);
    if (sanitizeRichTextHtml(editor.innerHTML) !== normalizedValue) {
      editor.innerHTML = normalizedValue;
      setSelectedImageIndex(null);
      setSelectedImageSize("AUTO");
      setImageSizeInput("");
      setSelectedImageBounds(null);
    }
    setEditorEmpty(isEditorEmpty(editor));
  }, [value]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      selectionRef.current = range.cloneRange();
      selectionSnapshotRef.current = selectionSnapshot(editor, range);
      setFontSizeInput(selectionFontSize(editor, selection));
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  function syncEditorWithValue(valueToSync: string) {
    const editor = editorRef.current;
    if (!editor) return;
    const normalizedValue = sanitizeRichTextHtml(valueToSync);
    if (sanitizeRichTextHtml(editor.innerHTML) !== normalizedValue) {
      editor.innerHTML = normalizedValue;
      setSelectedImageIndex(null);
      setSelectedImageSize("AUTO");
      setImageSizeInput("");
      setSelectedImageBounds(null);
    }
    setEditorEmpty(isEditorEmpty(editor));
  }

  function updateSelectedImageBounds(image?: HTMLImageElement | null) {
    const editor = editorRef.current;
    if (!editor || !image) {
      setSelectedImageBounds(null);
      return;
    }
    const editorBounds = editor.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    setSelectedImageBounds({
      left: imageBounds.right - editorBounds.left + editor.scrollLeft,
      top: imageBounds.bottom - editorBounds.top + editor.scrollTop,
    });
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || selectedImageIndex === null) return;
    const image = editor.querySelectorAll("img")[selectedImageIndex];
    if (!image) return;
    const sync = () => updateSelectedImageBounds(image);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(editor);
    observer.observe(image);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [selectedImageIndex, selectedImageSize]);

  function updateActiveFormats() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const hasEditorSelection = Boolean(
      editor &&
      selection?.rangeCount &&
      editor.contains(selection.getRangeAt(0).commonAncestorContainer),
    );
    setActiveFormats({
      bold: hasEditorSelection && document.queryCommandState("bold"),
      italic: hasEditorSelection && document.queryCommandState("italic"),
      underline: hasEditorSelection && document.queryCommandState("underline"),
    });
    setActiveAlignment(
      hasEditorSelection
        ? document.queryCommandState("justifyCenter")
          ? "center"
          : document.queryCommandState("justifyRight")
            ? "right"
            : document.queryCommandState("justifyFull")
              ? "justify"
              : document.queryCommandState("justifyLeft")
                ? "left"
                : null
        : null,
    );
    setFontSizeInput(hasEditorSelection ? selectionFontSize(editor, selection) : "");
  }

  function saveSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    rememberEditorSelection(editor, range);
    updateActiveFormats();
  }

  function rememberEditorSelection(editor: HTMLDivElement, range: Range) {
    if (!editor.contains(range.commonAncestorContainer)) return;
    selectionRef.current = range.cloneRange();
    selectionSnapshotRef.current = selectionSnapshot(editor, range);
  }

  function preserveEditorSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    rememberEditorSelection(editor, range);
  }

  function restoreSelection(
    snapshot = selectionSnapshotRef.current,
    fallbackRange = selectionRef.current,
  ) {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!selection || !editor) return false;
    if (snapshot) {
      const startNode = nodeFromPath(editor, snapshot.start.path);
      const endNode = nodeFromPath(editor, snapshot.end.path);
      if (startNode && endNode) {
        const startOffset = Math.min(
          snapshot.start.offset,
          startNode.nodeType === Node.TEXT_NODE
            ? (startNode.textContent?.length ?? 0)
            : startNode.childNodes.length,
        );
        const endOffset = Math.min(
          snapshot.end.offset,
          endNode.nodeType === Node.TEXT_NODE
            ? (endNode.textContent?.length ?? 0)
            : endNode.childNodes.length,
        );
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
        selectionRef.current = range.cloneRange();
        return true;
      }
    }
    if (!fallbackRange) return false;
    selection.removeAllRanges();
    selection.addRange(fallbackRange);
    return true;
  }

  function emitValue() {
    const editor = editorRef.current;
    if (!editor) return;
    const nextValue = isEditorEmpty(editor) ? "" : sanitizeRichTextHtml(editor.innerHTML);
    setEditorEmpty(isEditorEmpty(editor));
    onValueChange(nextValue);
  }

  function keepSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    saveSelection();
  }

  function applyCommand(command: string, commandValue?: string) {
    if (disabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, commandValue);
    saveSelection();
    updateActiveFormats();
    emitValue();
  }

  function applyFontSize(value = fontSizeInput) {
    const parsedSize = Number(value);
    if (!value.trim()) return;
    if (!Number.isFinite(parsedSize) || parsedSize < 8 || parsedSize > 96) {
      appToast.error("Размер шрифта должен быть от 8 до 96 px");
      return;
    }
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return;
    const savedSnapshot = selectionSnapshotRef.current;
    const savedRange = selectionRef.current?.cloneRange() ?? null;
    editor.focus();
    restoreSelection(savedSnapshot, savedRange);
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = `${Math.round(parsedSize)}px`;
    if (range.collapsed) {
      span.textContent = "\u200B";
      range.insertNode(span);
      range.setStart(span.firstChild!, 1);
      range.collapse(true);
    } else {
      span.append(range.extractContents());
      range.insertNode(span);
      range.selectNodeContents(span);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    setFontSizeInput(String(Math.round(parsedSize * 100) / 100));
    saveSelection();
    emitValue();
  }

  function insertHtml(html: string) {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.focus();
    restoreSelection();
    document.execCommand("insertHTML", false, html);
    saveSelection();
    emitValue();
  }

  async function insertImages(files: File[]) {
    const acceptedFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!acceptedFiles.length) return;
    const maxBytes = maxImageSizeMb * 1024 * 1024;
    for (const file of acceptedFiles) {
      if (file.size > maxBytes) {
        appToast.error(`Изображение «${file.name}» больше ${maxImageSizeMb} МБ`);
        continue;
      }
      try {
        const source = await readFileAsDataUrl(file);
        insertHtml(`<img src="${source}" alt="${escapeHtml(file.name || "Изображение")}">`);
      } catch (imageError) {
        appToast.error(
          imageError instanceof Error ? imageError.message : "Не удалось вставить изображение",
        );
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!images.length) return;
    event.preventDefault();
    void insertImages(images);
  }

  function handleImageInput(event: ChangeEvent<HTMLInputElement>) {
    void insertImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function selectImage(index: number | null) {
    const editor = editorRef.current;
    if (!editor) return;
    const images = Array.from(editor.querySelectorAll("img"));
    images.forEach((image, imageIndex) => {
      image.toggleAttribute("data-editor-selected", imageIndex === index);
    });
    const selectedImage = index === null ? null : images[index];
    const selectedSize = selectedImage?.style.width || "AUTO";
    setSelectedImageIndex(index);
    setSelectedImageSize(selectedSize);
    setImageSizeInput(selectedSize === "AUTO" ? "" : selectedSize.replace("%", ""));
    updateSelectedImageBounds(selectedImage);
  }

  function handleEditorClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) {
      selectImage(null);
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    const index = Array.from(editor.querySelectorAll("img")).indexOf(target);
    selectImage(index >= 0 ? index : null);
  }

  function setImageSize(size: string) {
    const editor = editorRef.current;
    if (!editor || selectedImageIndex === null) return;
    const image = editor.querySelectorAll("img")[selectedImageIndex];
    if (!image) return;
    if (size === "AUTO") image.style.removeProperty("width");
    else image.style.width = size;
    image.style.height = "auto";
    setSelectedImageSize(size);
    setImageSizeInput(size === "AUTO" ? "" : size.replace("%", ""));
    updateSelectedImageBounds(image);
    emitValue();
  }

  function applyImageSizeInput() {
    const value = imageSizeInput.trim();
    if (!value) {
      setImageSize("AUTO");
      return;
    }
    const width = Number(value);
    if (!Number.isFinite(width) || width < 10 || width > 100) {
      appToast.error("Размер изображения должен быть от 10 до 100 %");
      setImageSizeInput(selectedImageSize === "AUTO" ? "" : selectedImageSize.replace("%", ""));
      return;
    }
    const normalizedWidth = Math.round(width * 10) / 10;
    setImageSize(`${normalizedWidth}%`);
  }

  function handleImageResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || selectedImageIndex === null) return;
    const editor = editorRef.current;
    const image = editor?.querySelectorAll("img")[selectedImageIndex];
    if (!editor || !image) return;
    event.preventDefault();
    event.stopPropagation();
    imageResizeRef.current = {
      image,
      startX: event.clientX,
      startWidth: image.getBoundingClientRect().width,
      editorWidth: editor.clientWidth,
    };

    const resize = (moveEvent: PointerEvent) => {
      const resizeState = imageResizeRef.current;
      if (!resizeState) return;
      const width = Math.min(
        resizeState.editorWidth,
        Math.max(80, resizeState.startWidth + moveEvent.clientX - resizeState.startX),
      );
      const percent = Math.round((width / resizeState.editorWidth) * 1000) / 10;
      resizeState.image.style.width = `${percent}%`;
      resizeState.image.style.height = "auto";
      setSelectedImageSize(`${percent}%`);
      setImageSizeInput(String(percent));
      updateSelectedImageBounds(resizeState.image);
    };
    const finish = () => {
      if (!imageResizeRef.current) return;
      imageResizeRef.current = null;
      emitValue();
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function openLinkForm() {
    if (disabled) return;
    saveSelection();
    setLinkUrl("");
    setLinkText("");
    setLinkError("");
    setLinkFormOpen(true);
  }

  function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = normalizeHref(linkUrl);
    if (!href) {
      setLinkError("Укажите корректную ссылку");
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();
    const selection = window.getSelection();
    const hasSelectedText = Boolean(selection?.rangeCount && !selection.getRangeAt(0).collapsed);
    if (hasSelectedText) {
      document.execCommand("createLink", false, href);
    } else {
      insertHtml(`<a href="${escapeHtml(href)}">${escapeHtml(linkText.trim() || href)}</a>`);
    }
    saveSelection();
    emitValue();
    setLinkFormOpen(false);
  }

  return (
    <div className={`app-rich-text-editor ${error ? "is-error" : ""} ${className}`}>
      {label && (
        <label className="app-rich-text-editor__label" htmlFor={generatedId}>
          {label}
          {required && <b aria-hidden="true">*</b>}
        </label>
      )}
      <div className="app-rich-text-editor__shell">
        <div className="app-rich-text-editor__toolbar" aria-label="Форматирование текста">
          <div className="app-rich-text-editor__toolbar-group">
            <select
              aria-label="Шрифт"
              className="app-rich-text-editor__select app-rich-text-editor__select--font"
              defaultValue=""
              disabled={disabled}
              onMouseDown={saveSelection}
              onChange={(event) => applyCommand("fontName", event.target.value)}
            >
              <option value="" disabled>
                Шрифт
              </option>
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                  {font.label}
                </option>
              ))}
            </select>
            <div
              className="app-rich-text-editor__font-size-combobox"
              onMouseDown={(event) => {
                if (event.target === fontSizeInputRef.current) return;
                event.preventDefault();
                saveSelection();
                fontSizeInputRef.current?.focus();
                fontSizeInputRef.current?.showPicker?.();
              }}
            >
              <input
                ref={fontSizeInputRef}
                type="text"
                inputMode="decimal"
                list={`${generatedId}-font-sizes`}
                min={8}
                max={96}
                className="app-rich-text-editor__font-size-input"
                aria-label="Размер шрифта в пикселях"
                title="Размер шрифта в пикселях"
                value={fontSizeInput}
                placeholder="Размер"
                disabled={disabled}
                onPointerDownCapture={preserveEditorSelection}
                onFocus={updateActiveFormats}
                onChange={(event) => setFontSizeInput(event.target.value.replace(/[^\d.]/g, ""))}
                onBlur={() => applyFontSize()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyFontSize();
                  }
                }}
              />
              <span className="app-rich-text-editor__font-size-unit" aria-hidden="true">
                px
              </span>
              <ChevronDown
                className="app-rich-text-editor__font-size-chevron"
                size={17}
                aria-hidden="true"
              />
              <datalist id={`${generatedId}-font-sizes`}>
                {FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size} label={`${size} px`} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="app-rich-text-editor__toolbar-group">
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeFormats.bold ? " is-active" : ""}`}
              aria-pressed={activeFormats.bold}
              aria-label="Полужирный"
              title="Полужирный"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("bold")}
            >
              <Bold size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeFormats.italic ? " is-active" : ""}`}
              aria-pressed={activeFormats.italic}
              aria-label="Курсив"
              title="Курсив"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("italic")}
            >
              <Italic size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeFormats.underline ? " is-active" : ""}`}
              aria-pressed={activeFormats.underline}
              aria-label="Подчёркнутый"
              title="Подчёркнутый"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("underline")}
            >
              <Underline size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className="app-rich-text-editor__tool"
              aria-label="Очистить форматирование"
              title="Очистить форматирование"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("removeFormat")}
            >
              <RemoveFormatting size={17} />
            </AppButton>
          </div>
          <div className="app-rich-text-editor__toolbar-group">
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeAlignment === "left" ? " is-active" : ""}`}
              aria-pressed={activeAlignment === "left"}
              aria-label="Выровнять по левому краю"
              title="По левому краю"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("justifyLeft")}
            >
              <AlignLeft size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeAlignment === "center" ? " is-active" : ""}`}
              aria-pressed={activeAlignment === "center"}
              aria-label="Выровнять по центру"
              title="По центру"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("justifyCenter")}
            >
              <AlignCenter size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeAlignment === "right" ? " is-active" : ""}`}
              aria-pressed={activeAlignment === "right"}
              aria-label="Выровнять по правому краю"
              title="По правому краю"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("justifyRight")}
            >
              <AlignRight size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className={`app-rich-text-editor__tool${activeAlignment === "justify" ? " is-active" : ""}`}
              aria-pressed={activeAlignment === "justify"}
              aria-label="Выровнять по ширине"
              title="По ширине"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("justifyFull")}
            >
              <AlignJustify size={17} />
            </AppButton>
          </div>
          <div className="app-rich-text-editor__toolbar-group">
            <AppButton
              type="button"
              variant="ghost"
              className="app-rich-text-editor__tool"
              aria-label="Добавить ссылку"
              title="Добавить ссылку"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={openLinkForm}
            >
              <Link2 size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className="app-rich-text-editor__tool"
              aria-label="Убрать ссылку"
              title="Убрать ссылку"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => applyCommand("unlink")}
            >
              <Unlink size={17} />
            </AppButton>
            <AppButton
              type="button"
              variant="ghost"
              className="app-rich-text-editor__tool"
              aria-label="Добавить изображение"
              title="Добавить изображение"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus size={17} />
            </AppButton>
            <input
              ref={imageInputRef}
              className="app-rich-text-editor__image-input"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              disabled={disabled}
              onChange={handleImageInput}
            />
            <input
              type="number"
              inputMode="decimal"
              min={10}
              max={100}
              step={0.1}
              aria-label="Ширина выбранного изображения в процентах"
              title="Ширина выбранного изображения в процентах"
              className="app-rich-text-editor__image-size-input"
              value={imageSizeInput}
              placeholder="Фото, %"
              disabled={disabled || selectedImageIndex === null}
              onChange={(event) => setImageSizeInput(event.target.value)}
              onBlur={applyImageSizeInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyImageSizeInput();
                }
              }}
            />
          </div>
        </div>
        {linkFormOpen && (
          <form className="app-rich-text-editor__link-form" onSubmit={addLink}>
            <AppInput
              label="Ссылка"
              value={linkUrl}
              autoFocus
              error={linkError || undefined}
              placeholder="https://example.com"
              onChange={(event) => {
                setLinkUrl(event.target.value);
                setLinkError("");
              }}
            />
            <AppInput
              label="Текст ссылки"
              value={linkText}
              placeholder="Необязательно, если текст уже выделен"
              onChange={(event) => setLinkText(event.target.value)}
            />
            <div className="app-rich-text-editor__link-actions">
              <AppButton type="button" variant="ghost" onClick={() => setLinkFormOpen(false)}>
                Отмена
              </AppButton>
              <AppButton type="submit">Добавить</AppButton>
            </div>
          </form>
        )}
        <div className="app-rich-text-editor__content-wrap">
          {editorEmpty && (
            <span className="app-rich-text-editor__placeholder" aria-hidden="true">
              {placeholder}
            </span>
          )}
          <div
            ref={editorRef}
            id={generatedId}
            className="app-rich-text-editor__content"
            contentEditable={!disabled}
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-invalid={Boolean(error)}
            aria-disabled={disabled}
            onFocus={() => {
              isEditorFocusedRef.current = true;
              saveSelection();
            }}
            onBlur={() => {
              isEditorFocusedRef.current = false;
              syncEditorWithValue(latestValueRef.current);
            }}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onClick={handleEditorClick}
            onInput={() => {
              saveSelection();
              emitValue();
            }}
            onPaste={handlePaste}
          />
          {selectedImageBounds && (
            <button
              type="button"
              className="app-rich-text-editor__image-resize-handle"
              style={{ left: selectedImageBounds.left, top: selectedImageBounds.top }}
              aria-label="Изменить размер изображения"
              title="Потяните, чтобы изменить размер"
              onPointerDown={handleImageResizeStart}
            />
          )}
        </div>
      </div>
      {(hint || error) && <small className="app-rich-text-editor__message">{error || hint}</small>}
    </div>
  );
}
