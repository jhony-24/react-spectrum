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

import {Axis, Placement, PlacementAxis, SizeAxis} from '@react-types/overlays';

interface Position {
  top?: number,
  left?: number,
  bottom?: number,
  right?: number
}

interface Dimensions {
  width: number,
  height: number,
  top: number,
  left: number,
  scroll: Position
}

interface ParsedPlacement {
  placement: PlacementAxis,
  crossPlacement: PlacementAxis,
  axis: Axis,
  crossAxis: Axis,
  size: SizeAxis,
  crossSize: SizeAxis
}

interface Offset {
  top: number,
  left: number,
  width: number,
  height: number
}

interface PositionOpts {
  placement: Placement,
  targetNode: Element,
  overlayNode: Element,
  scrollNode: Element,
  padding: number,
  shouldFlip: boolean,
  boundaryElement: Element,
  offset: number,
  crossOffset: number,
  maxHeight?: number
}

export interface PositionResult {
  position?: Position,
  arrowOffsetLeft?: number,
  arrowOffsetTop?: number,
  maxHeight?: number,
  placement: PlacementAxis
}

const AXIS = {
  top: 'top',
  bottom: 'top',
  left: 'left',
  right: 'left'
};

const FLIPPED_DIRECTION = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
};

const CROSS_AXIS = {
  top: 'left',
  left: 'top'
};

const AXIS_SIZE = {
  top: 'height',
  left: 'width'
};

const PARSED_PLACEMENT_CACHE = {};

// @ts-ignore
let visualViewport = typeof window !== 'undefined' && window.visualViewport;

function getContainerDimensions(containerNode: Element): Dimensions {
  let width = 0, height = 0, top = 0, left = 0;
  let scroll: Position = {};

  if (containerNode.tagName === 'BODY') {
    let documentElement = document.documentElement;
    width = visualViewport?.width ?? documentElement.clientWidth;
    height = visualViewport?.height ?? documentElement.clientHeight;

    scroll.top = documentElement.scrollTop || containerNode.scrollTop;
    scroll.left = documentElement.scrollLeft || containerNode.scrollLeft;
  } else {
    ({width, height, top, left} = getOffset(containerNode));
    scroll.top = containerNode.scrollTop;
    scroll.left = containerNode.scrollLeft;
  }

  return {width, height, scroll, top, left};
}

function getScroll(node: Element): Offset {
  return {
    top: node.scrollTop,
    left: node.scrollLeft,
    width: node.scrollWidth,
    height: node.scrollHeight
  };
}

function getDelta(
  axis: Axis,
  offset: number,
  size: number,
  containerDimensions: Dimensions,
  padding: number
) {
  let containerScroll = containerDimensions.scroll[axis];
  let containerHeight = containerDimensions[AXIS_SIZE[axis]];

  let startEdgeOffset = offset - padding - containerScroll;
  let endEdgeOffset = offset + padding - containerScroll + size;

  if (startEdgeOffset < 0) {
    return -startEdgeOffset;
  } else if (endEdgeOffset > containerHeight) {
    return Math.max(containerHeight - endEdgeOffset, -startEdgeOffset);
  } else {
    return 0;
  }
}

function getMargins(node: Element): Position {
  let style = window.getComputedStyle(node);
  return {
    top: parseInt(style.marginTop, 10) || 0,
    bottom: parseInt(style.marginBottom, 10) || 0,
    left: parseInt(style.marginLeft, 10) || 0,
    right: parseInt(style.marginRight, 10) || 0
  };
}

function parsePlacement(input: Placement): ParsedPlacement {
  if (PARSED_PLACEMENT_CACHE[input]) {
    return PARSED_PLACEMENT_CACHE[input];
  }

  let [placement, crossPlacement] = input.split(' ');
  let axis: Axis = AXIS[placement] || 'right';
  let crossAxis: Axis = CROSS_AXIS[axis];

  if (!AXIS[crossPlacement]) {
    crossPlacement = 'center';
  }

  let size = AXIS_SIZE[axis];
  let crossSize = AXIS_SIZE[crossAxis];
  PARSED_PLACEMENT_CACHE[input] = {placement, crossPlacement, axis, crossAxis, size, crossSize};
  return PARSED_PLACEMENT_CACHE[input];
}

function computePosition(
  childOffset: Offset,
  boundaryDimensions: Dimensions,
  overlaySize: Offset,
  placementInfo: ParsedPlacement,
  offset: number,
  crossOffset: number,
  containerOffsetWithBoundary: Offset,
  isContainerPositioned: boolean
) {
  let {placement, crossPlacement, axis, crossAxis, size, crossSize} = placementInfo;
  let position: Position = {};

  // button position
  position[crossAxis] = childOffset[crossAxis];
  if (crossPlacement === 'center') {
    //  + (button size / 2) - (overlay size / 2)
    // at this point the overlay center should match the button center
    position[crossAxis] += (childOffset[crossSize] - overlaySize[crossSize]) / 2;
  } else if (crossPlacement !== crossAxis) {
    //  + (button size) - (overlay size)
    // at this point the overlay bottom should match the button bottom
    position[crossAxis] += (childOffset[crossSize] - overlaySize[crossSize]);
  }/* else {
    the overlay top should match the button top
  } */
  // add the crossOffset from props
  position[crossAxis] += crossOffset;

  // this is button center position - the overlay size + half of the button to align bottom of overlay with button center
  let minViablePosition = childOffset[crossAxis] + (childOffset[crossSize] / 2) - overlaySize[crossSize];
  // this is button position of center, aligns top of overlay with button center
  let maxViablePosition = childOffset[crossAxis] + (childOffset[crossSize] / 2);

  // clamp it into the range of the min/max positions
  position[crossAxis] = Math.min(Math.max(minViablePosition, position[crossAxis]), maxViablePosition);

  // Floor these so the position isn't placed on a partial pixel, only whole pixels. Shouldn't matter if it was floored or ceiled, so chose one.
  if (placement === axis) {
    // If the container is positioned (non-static), then we use the container's actual
    // height, as `bottom` will be relative to this height.  But if the container is static,
    // then it can only be the `document.body`, and `bottom` will be relative to _its_
    // container, which should be as large as boundaryDimensions.
    const containerHeight = (isContainerPositioned ? containerOffsetWithBoundary[size] : boundaryDimensions[size]);
    position[FLIPPED_DIRECTION[axis]] = Math.floor(containerHeight - childOffset[axis] + offset);
  } else {
    position[axis] = Math.floor(childOffset[axis] + childOffset[size] + offset);
  }

  return position;
}

function getMaxHeight(
  position: Position,
  boundaryDimensions: Dimensions,
  containerOffsetWithBoundary: Offset,
  childOffset: Offset,
  margins: Position,
  padding: number
) {
  return position.top != null
    // We want the distance between the top of the overlay to the bottom of the boundary
    ? Math.max(0,
      (boundaryDimensions.height + boundaryDimensions.top + boundaryDimensions.scroll.top) // this is the bottom of the boundary
      - (containerOffsetWithBoundary.top + position.top) // this is the top of the overlay
      - (margins.top + margins.bottom + padding) // save additional space for margin and padding
    )
    // We want the distance between the top of the trigger to the top of the boundary
    : Math.max(0,
      (childOffset.top + containerOffsetWithBoundary.top) // this is the top of the trigger
      - (boundaryDimensions.top + boundaryDimensions.scroll.top) // this is the top of the boundary
      - (margins.top + margins.bottom + padding) // save additional space for margin and padding
    );
}

function getAvailableSpace(
  boundaryDimensions: Dimensions,
  containerOffsetWithBoundary: Offset,
  childOffset: Offset,
  margins: Position,
  padding: number,
  placementInfo: ParsedPlacement
) {
  let {placement, axis, size} = placementInfo;
  if (placement === axis) {
    return Math.max(0, childOffset[axis] - boundaryDimensions[axis] - boundaryDimensions.scroll[axis] + containerOffsetWithBoundary[axis] - margins[axis] - margins[FLIPPED_DIRECTION[axis]] - padding);
  }

  return Math.max(0, boundaryDimensions[size] + boundaryDimensions[axis] + boundaryDimensions.scroll[axis] - containerOffsetWithBoundary[axis] - childOffset[axis] - childOffset[size] - margins[axis] - margins[FLIPPED_DIRECTION[axis]] - padding);
}

export function calculatePositionInternal(
  placementInput: Placement,
  childOffset: Offset,
  overlaySize: Offset,
  scrollSize: Offset,
  margins: Position,
  padding: number,
  flip: boolean,
  boundaryDimensions: Dimensions,
  containerOffsetWithBoundary: Offset,
  offset: number,
  crossOffset: number,
  isContainerPositioned: boolean,
  userSetMaxHeight?: number
): PositionResult {
  let placementInfo = parsePlacement(placementInput);
  let {size, crossAxis, crossSize, placement, crossPlacement} = placementInfo;
  let position = computePosition(childOffset, boundaryDimensions, overlaySize, placementInfo, offset, crossOffset, containerOffsetWithBoundary, isContainerPositioned);
  let normalizedOffset = offset;
  let space = getAvailableSpace(
    boundaryDimensions,
    containerOffsetWithBoundary,
    childOffset,
    margins,
    padding + offset,
    placementInfo
  );

  // Check if the scroll size of the overlay is greater than the available space to determine if we need to flip
  if (flip && scrollSize[size] > space) {
    let flippedPlacementInfo = parsePlacement(`${FLIPPED_DIRECTION[placement]} ${crossPlacement}` as Placement);
    let flippedPosition = computePosition(childOffset, boundaryDimensions, overlaySize, flippedPlacementInfo, offset, crossOffset, containerOffsetWithBoundary, isContainerPositioned);
    let flippedSpace = getAvailableSpace(
      boundaryDimensions,
      containerOffsetWithBoundary,
      childOffset,
      margins,
      padding + offset,
      flippedPlacementInfo
    );

    // If the available space for the flipped position is greater than the original available space, flip.
    if (flippedSpace > space) {
      placementInfo = flippedPlacementInfo;
      position = flippedPosition;
      normalizedOffset = offset;
    }
  }

  let boundaryLimits = {
    top: boundaryDimensions.top + boundaryDimensions.scroll.top,
    bottom: boundaryDimensions.top + boundaryDimensions.scroll.top + boundaryDimensions.height,
    left: boundaryDimensions.left + boundaryDimensions.scroll.left,
    right: boundaryDimensions.left + boundaryDimensions.scroll.left + boundaryDimensions.width
  };

  // for popover triggers close to the edge decrease the padding
  if (placementInfo.placement === 'left' || placementInfo.placement === 'right') {
    let centerOfButtonVertical = childOffset.top + childOffset.height / 2;
    // Really it should be center of button center + padding + half of arrow width > boundary but we don't have access to arrow dimensions
    if (centerOfButtonVertical + padding * 2 > boundaryLimits.bottom || centerOfButtonVertical - padding * 2 < boundaryLimits.top) {
      padding = 6; // setting the padding to 6px as defined by Spectrum for this case
    }
  } else if (placementInfo.placement === 'top' || placementInfo.placement === 'bottom') {
    let centerOfButtonHorizontal = childOffset.left + childOffset.width / 2;
    if (centerOfButtonHorizontal + padding * 2 > boundaryLimits.right || centerOfButtonHorizontal - padding * 2 < boundaryLimits.left) {
      padding = 6; // setting the padding to 6px as defined by Spectrum for this case
    }
  }

  let delta = getDelta(crossAxis, position[crossAxis], overlaySize[crossSize], boundaryDimensions, padding);
  position[crossAxis] += delta;

  let maxHeight = getMaxHeight(
    position,
    boundaryDimensions,
    containerOffsetWithBoundary,
    childOffset,
    margins,
    padding
  );

  if (userSetMaxHeight && userSetMaxHeight < maxHeight) {
    maxHeight = userSetMaxHeight;
  }

  overlaySize.height = Math.min(overlaySize.height, maxHeight);

  position = computePosition(childOffset, boundaryDimensions, overlaySize, placementInfo, normalizedOffset, crossOffset, containerOffsetWithBoundary, isContainerPositioned);
  delta = getDelta(crossAxis, position[crossAxis], overlaySize[crossSize], boundaryDimensions, padding);
  position[crossAxis] += delta;

  let arrowPosition: Position = {};
  arrowPosition[crossAxis] = (childOffset[crossAxis] - position[crossAxis] + childOffset[crossSize] / 2);

  return {
    position,
    maxHeight: maxHeight,
    arrowOffsetLeft: arrowPosition.left,
    arrowOffsetTop: arrowPosition.top,
    placement: placementInfo.placement
  };
}

/**
 * Determines where to place the overlay with regards to the target and the position of an optional indicator.
 */
export function calculatePosition(opts: PositionOpts): PositionResult {
  let {
    placement,
    targetNode,
    overlayNode,
    scrollNode,
    padding,
    shouldFlip,
    boundaryElement,
    offset,
    crossOffset,
    maxHeight
  } = opts;

  let container = ((overlayNode instanceof HTMLElement && overlayNode.offsetParent) || document.body) as Element;
  let isBodyContainer = container.tagName === 'BODY';
  const containerPositionStyle = window.getComputedStyle(container).position;
  let isContainerPositioned = !!containerPositionStyle && containerPositionStyle !== 'static';
  let childOffset: Offset = isBodyContainer ? getOffset(targetNode) : getPosition(targetNode, container);

  if (!isBodyContainer) {
    let {marginTop, marginLeft} = window.getComputedStyle(targetNode);
    childOffset.top += parseInt(marginTop, 10) || 0;
    childOffset.left += parseInt(marginLeft, 10) || 0;
  }

  let overlaySize: Offset = getOffset(overlayNode);
  let margins = getMargins(overlayNode);
  overlaySize.width += margins.left + margins.right;
  overlaySize.height += margins.top + margins.bottom;

  let scrollSize = getScroll(scrollNode);
  let boundaryDimensions = getContainerDimensions(boundaryElement);
  let containerOffsetWithBoundary: Offset = boundaryElement.tagName === 'BODY' ? getOffset(container) : getPosition(container, boundaryElement);

  return calculatePositionInternal(
    placement,
    childOffset,
    overlaySize,
    scrollSize,
    margins,
    padding,
    shouldFlip,
    boundaryDimensions,
    containerOffsetWithBoundary,
    offset,
    crossOffset,
    isContainerPositioned,
    maxHeight
  );
}

function getOffset(node: Element): Offset {
  let {top, left, width, height} = node.getBoundingClientRect();
  let {scrollTop, scrollLeft, clientTop, clientLeft} = document.documentElement;
  return {
    top: top + scrollTop - clientTop,
    left: left + scrollLeft - clientLeft,
    width,
    height
  };
}

function getPosition(node: Element, parent: Element): Offset {
  let style = window.getComputedStyle(node);
  let offset: Offset;
  if (style.position === 'fixed') {
    let {top, left, width, height} = node.getBoundingClientRect();
    offset = {top, left, width, height};
  } else {
    offset = getOffset(node);
    let parentOffset = getOffset(parent);
    let parentStyle = window.getComputedStyle(parent);
    parentOffset.top += (parseInt(parentStyle.borderTopWidth, 10) || 0) - parent.scrollTop;
    parentOffset.left += (parseInt(parentStyle.borderLeftWidth, 10) || 0) - parent.scrollLeft;
    offset.top -= parentOffset.top;
    offset.left -= parentOffset.left;
  }

  offset.top -= parseInt(style.marginTop, 10) || 0;
  offset.left -= parseInt(style.marginLeft, 10) || 0;
  return offset;
}
