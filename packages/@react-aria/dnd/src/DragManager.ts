/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {announce} from '@react-aria/live-announcer';
import {ariaHideOutside} from '@react-aria/overlays';
import {DragEndEvent, DragItem, DropActivateEvent, DropEnterEvent, DropEvent, DropExitEvent, DropItem, DropOperation, DropTarget as DroppableCollectionTarget, FocusableElement} from '@react-types/shared';
import {getDragModality, getTypes} from './utils';
import {getInteractionModality} from '@react-aria/interactions';
import type {LocalizedStringFormatter} from '@internationalized/string';
import {useEffect, useState} from 'react';

let dropTargets = new Map<Element, DropTarget>();
let dropItems = new Map<Element, DroppableItem>();
let dragSession: DragSession = null;
let subscriptions = new Set<() => void>();

interface DropTarget {
  element: FocusableElement,
  getDropOperation?: (types: Set<string>, allowedOperations: DropOperation[]) => DropOperation,
  onDropEnter?: (e: DropEnterEvent, dragTarget: DragTarget) => void,
  onDropExit?: (e: DropExitEvent) => void,
  onDropTargetEnter?: (target?: DroppableCollectionTarget) => void,
  onDropActivate?: (e: DropActivateEvent, target?: DroppableCollectionTarget) => void,
  onDrop?: (e: DropEvent, target?: DroppableCollectionTarget) => void,
  onKeyDown?: (e: KeyboardEvent, dragTarget: DragTarget) => void
}

export function registerDropTarget(target: DropTarget) {
  dropTargets.set(target.element, target);
  dragSession?.updateValidDropTargets();
  return () => {
    dropTargets.delete(target.element);
    dragSession?.updateValidDropTargets();
  };
}

interface DroppableItem {
  element: FocusableElement,
  target: DroppableCollectionTarget,
  getDropOperation?: (types: Set<string>, allowedOperations: DropOperation[]) => DropOperation
}

export function registerDropItem(item: DroppableItem) {
  dropItems.set(item.element, item);
  return () => {
    dropItems.delete(item.element);
  };
}

interface DragTarget {
  element: FocusableElement,
  items: DragItem[],
  allowedDropOperations: DropOperation[],
  onDragEnd?: (e: DragEndEvent) => void
}

export function beginDragging(target: DragTarget, stringFormatter: LocalizedStringFormatter) {
  if (dragSession) {
    throw new Error('Cannot begin dragging while already dragging');
  }

  dragSession = new DragSession(target, stringFormatter);
  requestAnimationFrame(() => {
    dragSession.setup();
    if (
      getDragModality() === 'keyboard' ||
      (getDragModality() === 'touch' && getInteractionModality() === 'virtual')
    ) {
      dragSession.next();
    }
  });

  for (let cb of subscriptions) {
    cb();
  }
}

export function useDragSession() {
  let [session, setSession] = useState(dragSession);

  useEffect(() => {
    let cb = () => setSession(dragSession);
    subscriptions.add(cb);
    return () => {
      subscriptions.delete(cb);
    };
  }, []);

  return session;
}

function endDragging() {
  dragSession = null;
  for (let cb of subscriptions) {
    cb();
  }
}

export function isValidDropTarget(element: Element): boolean {
  for (let target of dropTargets.keys()) {
    if (target.contains(element)) {
      return true;
    }
  }

  return false;
}

const CANCELED_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointerover',
  'pointerout',
  'pointerup',
  'mousedown',
  'mousemove',
  'mouseenter',
  'mouseleave',
  'mouseover',
  'mouseout',
  'mouseup',
  'touchstart',
  'touchmove',
  'touchend',
  'keyup',
  'focusin',
  'focusout'
];

const CLICK_EVENTS = [
  'pointerup',
  'mouseup',
  'touchend'
];

const MESSAGES = {
  keyboard: 'dragStartedKeyboard',
  touch: 'dragStartedTouch',
  virtual: 'dragStartedVirtual'
};

class DragSession {
  dragTarget: DragTarget;
  validDropTargets: DropTarget[];
  currentDropTarget: DropTarget;
  currentDropItem: DroppableItem;
  dropOperation: DropOperation;
  private mutationObserver: MutationObserver;
  private restoreAriaHidden: () => void;
  private stringFormatter: LocalizedStringFormatter;
  private isVirtualClick: boolean;
  private initialFocused: boolean;

  constructor(target: DragTarget, stringFormatter: LocalizedStringFormatter) {
    this.dragTarget = target;
    this.stringFormatter = stringFormatter;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.cancelEvent = this.cancelEvent.bind(this);
    this.initialFocused = false;
  }

  setup() {
    document.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('focus', this.onFocus, true);
    window.addEventListener('blur', this.onBlur, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);

    for (let event of CANCELED_EVENTS) {
      document.addEventListener(event, this.cancelEvent, true);
    }

    this.mutationObserver = new MutationObserver(() =>
      this.updateValidDropTargets()
    );
    this.updateValidDropTargets();

    announce(this.stringFormatter.format(MESSAGES[getDragModality()]));
  }

  teardown() {
    document.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('focus', this.onFocus, true);
    window.removeEventListener('blur', this.onBlur, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('pointerdown', this.onPointerDown, true);

    for (let event of CANCELED_EVENTS) {
      document.removeEventListener(event, this.cancelEvent, true);
    }

    this.mutationObserver.disconnect();
    this.restoreAriaHidden();
  }

  onKeyDown(e: KeyboardEvent) {
    this.cancelEvent(e);

    if (e.key === 'Escape') {
      this.cancel();
      return;
    }

    if (e.key === 'Enter') {
      if (e.altKey) {
        this.activate();
      } else {
        this.drop();
      }
      return;
    }

    if (e.key === 'Tab' && !(e.metaKey || e.altKey || e.ctrlKey)) {
      if (e.shiftKey) {
        this.previous();
      } else {
        this.next();
      }
    }

    if (typeof this.currentDropTarget?.onKeyDown === 'function') {
      this.currentDropTarget.onKeyDown(e, this.dragTarget);
    }
  }

  onFocus(e: FocusEvent) {
    // Prevent focus events, except to the original drag target.
    if (e.target !== this.dragTarget.element) {
      this.cancelEvent(e);
    }

    // Ignore focus events on the window/document (JSDOM). Will be handled in onBlur, below.
    if (!(e.target instanceof HTMLElement) || e.target === this.dragTarget.element) {
      return;
    }

    let dropTarget = this.validDropTargets.find(target => target.element.contains(e.target as HTMLElement));
    if (!dropTarget) {
      if (this.currentDropTarget) {
        this.currentDropTarget.element.focus();
      } else {
        this.dragTarget.element.focus();
      }
      return;
    }

    let item = dropItems.get(e.target as HTMLElement);
    this.setCurrentDropTarget(dropTarget, item);
  }

  onBlur(e: FocusEvent) {
    if (e.target !== this.dragTarget.element) {
      this.cancelEvent(e);
    }

    // If nothing is gaining focus, or e.relatedTarget is the window/document (JSDOM),
    // restore focus back to the current drop target if any, or the original drag target.
    if (!e.relatedTarget || !(e.relatedTarget instanceof HTMLElement)) {
      if (this.currentDropTarget) {
        this.currentDropTarget.element.focus();
      } else {
        this.dragTarget.element.focus();
      }
    }
  }

  onClick(e: MouseEvent) {
    this.cancelEvent(e);
    if (e.detail === 0 || this.isVirtualClick) {
      if (e.target === this.dragTarget.element) {
        this.cancel();
        return;
      }

      let dropTarget = this.validDropTargets.find(target => target.element.contains(e.target as HTMLElement));
      if (dropTarget) {
        let item = dropItems.get(e.target as HTMLElement);
        this.setCurrentDropTarget(dropTarget, item);
        this.drop(item);
      }
    }
  }

  onPointerDown(e: PointerEvent) {
    // Android Talkback double tap has e.detail = 1 for onClick. Detect the virtual click in onPointerDown before onClick fires
    // so we can properly perform cancel and drop operations.
    this.cancelEvent(e);
    this.isVirtualClick = isVirtualPointerEvent(e);
  }

  cancelEvent(e: Event) {
    // Allow focusin and focusout on the drag target so focus ring works properly.
    if ((e.type === 'focusin' || e.type === 'focusout') && e.target === this.dragTarget?.element) {
      return;
    }

    // Allow default for events that might cancel a click event
    if (!CLICK_EVENTS.includes(e.type)) {
      e.preventDefault();
    }

    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  updateValidDropTargets() {
    if (!this.mutationObserver) {
      return;
    }

    this.mutationObserver.disconnect();
    if (this.restoreAriaHidden) {
      this.restoreAriaHidden();
    }

    this.validDropTargets = findValidDropTargets(this.dragTarget);
    if (this.currentDropTarget && !this.validDropTargets.includes(this.currentDropTarget)) {
      this.setCurrentDropTarget(this.validDropTargets[0]);
    }

    // Find valid drop items within collections
    let types = getTypes(this.dragTarget.items);
    let validDropItems = [...dropItems.values()].filter(item => {
      if (typeof item.getDropOperation === 'function') {
        return item.getDropOperation(types, this.dragTarget.allowedDropOperations) !== 'cancel';
      }

      return true;
    });

    // Filter out drop targets that contain valid items. We don't want to stop hiding elements
    // other than the drop items that exist inside the collection.
    let visibleDropTargets = this.validDropTargets.filter(target =>
      !validDropItems.some(item => target.element.contains(item.element))
    );

    this.restoreAriaHidden = ariaHideOutside([
      this.dragTarget.element,
      ...validDropItems.map(item => item.element),
      ...visibleDropTargets.map(target => target.element)
    ]);

    this.mutationObserver.observe(document.body, {subtree: true, attributes: true, attributeFilter: ['aria-hidden']});
  }

  next() {
    if (!this.currentDropTarget) {
      this.setCurrentDropTarget(this.validDropTargets[0]);
      return;
    }

    let index = this.validDropTargets.indexOf(this.currentDropTarget);
    if (index < 0) {
      this.setCurrentDropTarget(this.validDropTargets[0]);
      return;
    }

    // If we've reached the end of the valid drop targets, cycle back to the original drag target.
    // This lets the user cancel the drag in case they don't have an Escape key (e.g. iPad keyboard case).
    if (index === this.validDropTargets.length - 1) {
      if (!this.dragTarget.element.closest('[aria-hidden="true"]')) {
        this.setCurrentDropTarget(null);
        this.dragTarget.element.focus();
      } else {
        this.setCurrentDropTarget(this.validDropTargets[0]);
      }
    } else {
      this.setCurrentDropTarget(this.validDropTargets[index + 1]);
    }
  }

  previous() {
    if (!this.currentDropTarget) {
      this.setCurrentDropTarget(this.validDropTargets[this.validDropTargets.length - 1]);
      return;
    }

    let index = this.validDropTargets.indexOf(this.currentDropTarget);
    if (index < 0) {
      this.setCurrentDropTarget(this.validDropTargets[this.validDropTargets.length - 1]);
      return;
    }

    // If we've reached the start of the valid drop targets, cycle back to the original drag target.
    // This lets the user cancel the drag in case they don't have an Escape key (e.g. iPad keyboard case).
    if (index === 0) {
      if (!this.dragTarget.element.closest('[aria-hidden="true"]')) {
        this.setCurrentDropTarget(null);
        this.dragTarget.element.focus();
      } else {
        this.setCurrentDropTarget(this.validDropTargets[this.validDropTargets.length - 1]);
      }
    } else {
      this.setCurrentDropTarget(this.validDropTargets[index - 1]);
    }
  }

  setCurrentDropTarget(dropTarget: DropTarget, item?: DroppableItem) {
    if (dropTarget !== this.currentDropTarget) {
      if (this.currentDropTarget && typeof this.currentDropTarget.onDropExit === 'function') {
        let rect = this.currentDropTarget.element.getBoundingClientRect();
        this.currentDropTarget.onDropExit({
          type: 'dropexit',
          x: rect.left + (rect.width / 2),
          y: rect.top + (rect.height / 2)
        });
      }

      this.currentDropTarget = dropTarget;

      if (dropTarget) {
        if (typeof dropTarget.onDropEnter === 'function') {
          let rect = dropTarget.element.getBoundingClientRect();
          dropTarget.onDropEnter({
            type: 'dropenter',
            x: rect.left + (rect.width / 2),
            y: rect.top + (rect.height / 2)
          }, this.dragTarget);
        }

        if (!item) {
          dropTarget?.element.focus();
        }
      }
    }


    if (item !== this.currentDropItem) {
      if (item && typeof this.currentDropTarget.onDropTargetEnter === 'function') {
        this.currentDropTarget.onDropTargetEnter(item?.target);
      }

      item?.element.focus();
      this.currentDropItem = item;

      // Annouce first drop target after drag start announcement finishes.
      // Otherwise, it will never get announced because drag start announcement is assertive.
      if (!this.initialFocused) {
        announce(item?.element.getAttribute('aria-label'), 'polite');
        this.initialFocused = true;
      }
    }
  }

  end() {
    this.teardown();

    if (typeof this.dragTarget.onDragEnd === 'function') {
      let target = this.currentDropTarget && this.dropOperation !== 'cancel' ? this.currentDropTarget : this.dragTarget;
      let rect = target.element.getBoundingClientRect();
      this.dragTarget.onDragEnd({
        type: 'dragend',
        x: rect.x + (rect.width / 2),
        y: rect.y + (rect.height / 2),
        dropOperation: this.dropOperation
      });
    }

    // Blur and re-focus the drop target so that the focus ring appears.
    if (this.currentDropTarget) {
      this.currentDropTarget.element.blur();
      this.currentDropTarget.element.focus();
    }

    this.setCurrentDropTarget(null);
    endDragging();
  }

  cancel() {
    this.end();
    if (!this.dragTarget.element.closest('[aria-hidden="true"]')) {
      this.dragTarget.element.focus();
    }

    announce(this.stringFormatter.format('dropCanceled'));
  }

  drop(item?: DroppableItem) {
    if (!this.currentDropTarget) {
      this.cancel();
      return;
    }

    if (typeof item?.getDropOperation === 'function') {
      let types = getTypes(this.dragTarget.items);
      this.dropOperation = item.getDropOperation(types, this.dragTarget.allowedDropOperations);
    } else if (typeof this.currentDropTarget.getDropOperation === 'function') {
      let types = getTypes(this.dragTarget.items);
      this.dropOperation = this.currentDropTarget.getDropOperation(types, this.dragTarget.allowedDropOperations);
    } else {
      // TODO: show menu ??
      this.dropOperation = this.dragTarget.allowedDropOperations[0];
    }

    if (typeof this.currentDropTarget.onDrop === 'function') {
      let items: DropItem[] = this.dragTarget.items.map(item => ({
        kind: 'text',
        types: new Set(Object.keys(item)),
        getText: (type: string) => Promise.resolve(item[type])
      }));

      let rect = this.currentDropTarget.element.getBoundingClientRect();
      this.currentDropTarget.onDrop({
        type: 'drop',
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
        items,
        dropOperation: this.dropOperation
      }, item?.target);
    }

    this.end();
    announce(this.stringFormatter.format('dropComplete'));
  }

  activate() {
    if (this.currentDropTarget && typeof this.currentDropTarget.onDropActivate === 'function') {
      let rect = this.currentDropTarget.element.getBoundingClientRect();
      this.currentDropTarget.onDropActivate({
        type: 'dropactivate',
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2)
      });
    }
  }
}

function findValidDropTargets(options: DragTarget) {
  let types = getTypes(options.items);
  return [...dropTargets.values()].filter(target => {
    if (target.element.closest('[aria-hidden="true"]')) {
      return false;
    }

    if (typeof target.getDropOperation === 'function') {
      return target.getDropOperation(types, options.allowedDropOperations) !== 'cancel';
    }

    return true;
  });
}

function isVirtualPointerEvent(event: PointerEvent) {
  // If the pointer size is zero, then we assume it's from a screen reader.
  // Android TalkBack double tap will sometimes return a event with width and height of 1
  // and pointerType === 'mouse' so we need to check for a specific combination of event attributes.
  // Cannot use "event.pressure === 0" as the sole check due to Safari pointer events always returning pressure === 0
  // instead of .5, see https://bugs.webkit.org/show_bug.cgi?id=206216
  return (
    (event.width === 0 && event.height === 0) ||
    (event.width === 1 &&
      event.height === 1 &&
      event.pressure === 0 &&
      event.detail === 0
    )
  );
}
