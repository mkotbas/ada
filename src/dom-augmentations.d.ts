export {};

declare global {
  interface Element {
    value: any;
    checked: boolean;
    disabled: boolean;
    hidden: boolean;
    files: FileList | null;
    dataset: DOMStringMap;
    readOnly: boolean;
    reset(): void;
    focus(options?: FocusOptions): void;
    offsetParent: Element | null;
  }

  interface EventTarget {
    value: any;
    checked: boolean;
    disabled: boolean;
    files: FileList | null;
    dataset: DOMStringMap;
  }
}
