/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {AriaGridListProps} from '@react-types/list';
import {DOMAttributes, KeyboardDelegate} from '@react-types/shared';
import {filterDOMProps, mergeProps, useId} from '@react-aria/utils';
import {Key, RefObject} from 'react';
import {listMap} from './utils';
import {ListState} from '@react-stately/list';
import {useGridSelectionAnnouncement, useHighlightSelectionDescription} from '@react-aria/grid';
import {useSelectableList} from '@react-aria/selection';

export interface AriaGridListOptions<T> extends Omit<AriaGridListProps<T>, 'children'> {
  /** Whether the list uses virtual scrolling. */
  isVirtualized?: boolean,
  /**
   * An optional keyboard delegate implementation for type to select,
   * to override the default.
   */
  keyboardDelegate?: KeyboardDelegate,
  /**
   * A function that returns the text that should be announced by assistive technology when a row is added or removed from selection.
   * @default (key) => state.collection.getItem(key)?.textValue
   */
  getRowText?: (key: Key) => string
}

export interface GridListAria {
  /** Props for the grid element. */
  gridProps: DOMAttributes
}

/**
 * Provides the behavior and accessibility implementation for a list component with interactive children.
 * A grid list displays data in a single column and enables a user to navigate its contents via directional navigation keys.
 * @param props - Props for the list.
 * @param state - State for the list, as returned by `useListState`.
 * @param ref - The ref attached to the list element.
 */
export function useGridList<T>(props: AriaGridListOptions<T>, state: ListState<T>, ref: RefObject<HTMLElement>): GridListAria {
  let {
    isVirtualized,
    keyboardDelegate,
    getRowText,
    onAction
  } = props;

  if (!props['aria-label'] && !props['aria-labelledby']) {
    console.warn('An aria-label or aria-labelledby prop is required for accessibility.');
  }

  let {listProps} = useSelectableList({
    selectionManager: state.selectionManager,
    collection: state.collection,
    disabledKeys: state.disabledKeys,
    ref,
    keyboardDelegate: keyboardDelegate,
    isVirtualized,
    selectOnFocus: state.selectionManager.selectionBehavior === 'replace'
  });

  let id = useId();
  listMap.set(state, {id, onAction});

  let descriptionProps = useHighlightSelectionDescription({
    selectionManager: state.selectionManager,
    hasItemActions: !!onAction
  });

  let domProps = filterDOMProps(props, {labelable: true});
  let gridProps: DOMAttributes = mergeProps(
    domProps,
    {
      role: 'grid',
      id,
      'aria-multiselectable': state.selectionManager.selectionMode === 'multiple' ? 'true' : undefined
    },
    listProps,
    descriptionProps
  );

  if (isVirtualized) {
    gridProps['aria-rowcount'] = state.collection.size;
    gridProps['aria-colcount'] = 1;
  }

  useGridSelectionAnnouncement({getRowText}, state);

  return {
    gridProps
  };
}
