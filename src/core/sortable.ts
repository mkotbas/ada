export interface SortableContainerOptions {
  readyKey?: string;
  handleSelector?: string;
  draggingClass?: string;
  activeContainerClass?: string;
  dropTargetClass?: string;
  interactiveSelector?: string;
  itemFilter?: (item: HTMLElement) => boolean;
  onDragEnd?: ((container: HTMLElement) => void) | null;
}

const DEFAULT_INTERACTIVE_SELECTOR = 'button, input, select, textarea, label, a';

function getClosestDraggableElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest('[draggable="true"]') : null;
}

function getDirectSortableItem(target: EventTarget | null, container: HTMLElement, itemSelector: string): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const item = target.closest(itemSelector);
  return item instanceof HTMLElement && item.parentElement === container ? item : null;
}

function getDragAfterElement(
  container: HTMLElement,
  itemSelector: string,
  draggingItem: HTMLElement,
  clientY: number,
  itemFilter?: (item: HTMLElement) => boolean,
): HTMLElement | null {
  const items = Array.from(container.querySelectorAll(`:scope > ${itemSelector}`) as NodeListOf<HTMLElement>)
    .filter((item) => item !== draggingItem && !(itemFilter && !itemFilter(item)) && !item.classList.contains('dragging'));

  return items.reduce(
    (closest, item) => {
      const box = item.getBoundingClientRect();
      const offset = clientY - box.top - box.height / 2;
      return offset < 0 && offset > closest.offset ? { offset, element: item } : closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null as HTMLElement | null },
  ).element;
}

function clearDropTarget(currentDropTarget: HTMLElement | null, dropTargetClass: string): null {
  if (currentDropTarget instanceof HTMLElement) currentDropTarget.classList.remove(dropTargetClass);
  return null;
}

export function setupSortableContainer(container: HTMLElement | null, itemSelector: string, options: SortableContainerOptions = {}): void {
  if (!(container instanceof HTMLElement)) return;
  const {
    readyKey = 'dragScopeReady',
    handleSelector = '',
    draggingClass = 'dragging',
    activeContainerClass = 'sortable-container-active',
    dropTargetClass = 'sortable-drop-target',
    interactiveSelector = DEFAULT_INTERACTIVE_SELECTOR,
    itemFilter,
    onDragEnd = null,
  } = options;

  if (container.dataset[readyKey] === 'true') return;
  container.dataset[readyKey] = 'true';

  let draggingItem: HTMLElement | null = null;
  let armedItem: HTMLElement | null = null;
  let dragStarted = false;
  let currentDropTarget: HTMLElement | null = null;

  const resetArmedItem = (): void => { armedItem = null; };
  const clearDragState = (): void => {
    if (draggingItem instanceof HTMLElement) draggingItem.classList.remove(draggingClass);
    draggingItem = null;
    dragStarted = false;
    container.classList.remove(activeContainerClass);
    currentDropTarget = clearDropTarget(currentDropTarget, dropTargetClass);
    resetArmedItem();
  };

  container.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const item = getDirectSortableItem(target, container, itemSelector);
    if (!(item instanceof HTMLElement) || (itemFilter && !itemFilter(item))) {
      armedItem = null;
      return;
    }
    if (handleSelector) {
      armedItem = target?.closest(handleSelector) ? item : null;
      return;
    }
    if (target?.closest(interactiveSelector)) {
      armedItem = null;
      return;
    }
    armedItem = item;
  });
  container.addEventListener('pointerup', resetArmedItem);
  container.addEventListener('pointercancel', resetArmedItem);

  container.addEventListener('dragstart', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const item = getDirectSortableItem(target, container, itemSelector);
    const closestDraggable = getClosestDraggableElement(target);
    if (closestDraggable instanceof HTMLElement && closestDraggable !== item) return;
    if (!(item instanceof HTMLElement) || item !== armedItem || (itemFilter && !itemFilter(item))) {
      event.preventDefault();
      resetArmedItem();
      return;
    }
    draggingItem = item;
    dragStarted = true;
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.type || item.dataset.id || item.className || 'sortable-item');
    }
    container.classList.add(activeContainerClass);
    requestAnimationFrame(() => item.classList.add(draggingClass));
  });

  container.addEventListener('dragover', (event) => {
    if (!(draggingItem instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const afterElement = getDragAfterElement(container, itemSelector, draggingItem, event.clientY, itemFilter);
    if (currentDropTarget !== afterElement) {
      currentDropTarget = clearDropTarget(currentDropTarget, dropTargetClass);
      if (afterElement instanceof HTMLElement) {
        afterElement.classList.add(dropTargetClass);
        currentDropTarget = afterElement;
      }
    }
    if (!afterElement) {
      container.appendChild(draggingItem);
      return;
    }
    if (afterElement !== draggingItem) container.insertBefore(draggingItem, afterElement);
  });

  container.addEventListener('drop', (event) => {
    if (!(draggingItem instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
  });

  container.addEventListener('dragend', () => {
    const shouldNotify = dragStarted;
    clearDragState();
    if (shouldNotify && typeof onDragEnd === 'function') onDragEnd(container);
  });
}
