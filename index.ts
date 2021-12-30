import { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { showNotification } from '../../../api/antd';
import {
  focusEditorView,
  getContentFromEditorView,
  undoContentToEditorView,
  setSelection,
} from '../../../api/codemirror';
import { EDockingType } from '../../../api/docking/types';
import { formatMessageWithoutReact } from '../../../i18n';
import stores from '../../../stores';
import { showVirtualKeyboard } from '../../../stores/helpers';
import { getClientSize } from '../../../utils/dom';
import {
  checkStrIsStringOrNumber,
  checkTextByteLimit,
  isMobile,
} from '../../../utils/tool';
import toolbarStore from '../../TextSelectionToolbar/store';
import toolBarStore from '../../ToolBar/store';
import virtualKeyboardStore from '../../VirtualKeyboard/store';
import store from '../store';

let anchor: number, head: number;
let canDrag = false;
let myTimer: NodeJS.Timeout | null = null;

export const getAfterPos = (pos: number): number => {
  const view = store.getEditorView();
  if (view) {
    const text = view.state.doc.slice(pos, pos + 1) as any;
    const str = text.text[0];
    const bool = checkStrIsStringOrNumber(str);

    if (bool) {
      return getAfterPos(pos + 1);
    } else {
      return pos;
    }
  } else {
    return pos;
  }
};

export const getBeforePos = (pos: number): number => {
  const view = store.getEditorView();
  if (view) {
    const text = view.state.doc.slice(pos - 1, pos) as any;
    const str = text.text[0];
    const bool = checkStrIsStringOrNumber(str);
    if (bool) {
      return getBeforePos(pos - 1);
    } else {
      return pos;
    }
  } else {
    return pos;
  }
};

// NOTE: 给selectionLayer 添加类名 以区分一个 selectionBackgroundList 和多个 selectionBackgroundList
export const setSelectionLayerClassname = () => {
  const selectionBackgroundList: NodeListOf<HTMLElement> | null =
    document.querySelectorAll('.cm-selectionBackground');
  const selectionLayer: HTMLElement | null =
    document.querySelector('.cm-selectionLayer');
  if (selectionLayer) {
    if (selectionBackgroundList.length > 1) {
      selectionLayer.classList.remove('single');
      selectionLayer.classList.add('multple');
    } else if (selectionBackgroundList.length === 1) {
      selectionLayer.classList.remove('multple');
      selectionLayer.classList.add('single');
    }
  }
};

export const removeSelectionLayerClassname = () => {
  const selectionLayer: HTMLElement | null =
    document.querySelector('.cm-selectionLayer');
  if (selectionLayer) {
    selectionLayer.classList.remove('single');
    selectionLayer.classList.remove('multple');
  }
};

const clearMyTimeout = () => {
  if (myTimer) {
    clearTimeout(myTimer);
    myTimer = null;
  }
};

export const setSelectionCursorPosition = () => {
  if (
    store.bluetoothKeyboard ||
    stores.configStore.disabledSelfResearchEditorSelection
  )
    return;
  const selections: NodeListOf<HTMLElement> | null = document.querySelectorAll(
    '.cm-selectionBackground'
  );
  const headerHeight = stores.configStore.headerHeight;
  const selectionLength = selections.length;
  if (!selectionLength) return;
  const firstSelectionLeft = selections[0].getBoundingClientRect().left;
  const firstSelectionTop = selections[0].getBoundingClientRect().top;
  const firstSelectionWidth = selections[0].getBoundingClientRect().width;
  const lastSelectionLeft =
    selections[selectionLength - 1].getBoundingClientRect().left;
  const lastSelectionTop =
    selections[selectionLength - 1].getBoundingClientRect().top;
  const lastSelectionWidth =
    selections[selectionLength - 1].getBoundingClientRect().width;
  clearMyTimeout();
  setSelectionLayerClassname();

  if (selectionLength === 1) {
    store.setCursorLeftX(firstSelectionLeft - 10);
    store.setCursorLeftY(firstSelectionTop - 10 - headerHeight);
    store.setCursorRightX(firstSelectionLeft + firstSelectionWidth - 10);
    store.setCursorRightY(firstSelectionTop - 10 - headerHeight);
  } else if (selectionLength > 1) {
    store.setCursorLeftX(firstSelectionLeft - 10);
    store.setCursorLeftY(firstSelectionTop - 10 - headerHeight);
    store.setCursorRightX(lastSelectionLeft + lastSelectionWidth - 10);
    store.setCursorRightY(lastSelectionTop - 10 - headerHeight);
  }
};

export const handleSelectionLeftCursorTouch = (event: React.TouchEvent) => {
  handleSelectionCursorTouch(event, 'left');
};

export const handleSelectionRightCursorTouch = (event: React.TouchEvent) => {
  handleSelectionCursorTouch(event, 'right');
};

const handleSelectionCursorTouch = (
  event: React.TouchEvent,
  leftOrRight: 'left' | 'right'
) => {
  clearMyTimeout();
  store.setCursorVisible(false);
  const lineHeight = Number(store.fontSize.split('px')[0]);
  const touch = event.targetTouches[0];
  const coords = { x: touch.pageX, y: touch.pageY - lineHeight };
  const view = store.getEditorView();

  if (view) {
    if (leftOrRight === 'left') {
      head = view.posAtCoords(coords) || 0;
    } else {
      anchor = view.posAtCoords(coords) || 0;
    }
    setSelection(view, head, anchor);

    if (head === anchor) {
      // NOTE: 如果滑到了head === anchor的位置,则设置为光标点击出现操作台的状态
      hideSelectionCursor();
      focusEditorView(view);
      const posCoords = view.coordsAtPos(head);
      if (posCoords?.left && posCoords?.top) {
        setOperationPosition(posCoords.left, posCoords.top);
      }
      removeSystemCursorClass();
    }
    setSelectionLayerClassname();
    toolbarStore.setVisible(false);
  }
};

export function handleCursorTouchEnd() {
  setSelectionCursorPosition(); // NOTE: 结束需要重新绑定事件，因为 selection 元素更新了。
  handleSetOperationTop();
  handleSetOperationLeft();
  toolbarStore.setVisible(true);
  const view = store.getEditorView();
  if (view) {
    const { from, to } = view.state.selection.ranges[0];
    toolbarStore.setSingleTouch(from === to);
  }
  if (head > anchor) {
    [head, anchor] = [anchor, head];
  }
}

export const handleSetOperationTop = () => {
  const headerHeight = stores.configStore.headerHeight;
  const selections: NodeListOf<HTMLElement> | null = document.querySelectorAll(
    '.cm-selectionBackground'
  );
  const { height: clientHeight } = getClientSize();
  if (selections.length === 0) return;
  const startTop = selections[0].getBoundingClientRect().top;
  const endHeight = Number(
    selections[selections.length - 1].style.height.split('px')[0]
  );
  const endTop = selections[selections.length - 1].getBoundingClientRect().top;
  if (startTop - headerHeight <= 50) {
    if (endTop + 55 > clientHeight) {
      const view = store.getEditorView();
      if (view) {
        let centerCoords;
        if (anchor !== undefined && head !== undefined) {
          centerCoords = view.coordsAtPos((anchor - head) / 2 + head);
        }
        if (centerCoords?.top) {
          toolbarStore.setOpeartionTop(
            centerCoords.top - 65 <= 0
              ? centerCoords.top + 50
              : centerCoords.top - 55 - headerHeight
          );
        }
      }
    } else {
      if (endHeight > 25) {
        toolbarStore.setOpeartionTop(endTop + 45 - headerHeight);
      } else {
        toolbarStore.setOpeartionTop(endTop + 35 - headerHeight);
      }
    }
    toolbarStore.setIsTriangleBottom(false);
  } else {
    toolbarStore.setOpeartionTop(startTop - 55 - headerHeight);
    toolbarStore.setIsTriangleBottom(true);
  }
};

export const handleSetOperationLeft = () => {
  const { width: clientWidth } = getClientSize();
  const gutter: HTMLDivElement | null = document.querySelector('.cm-gutters');
  let gutterWidth = 32;
  if (gutter) {
    gutterWidth = gutter.getBoundingClientRect().width;
  }
  const view = store.getEditorView();
  const selections: NodeListOf<HTMLElement> | null = document.querySelectorAll(
    '.cm-selectionBackground'
  );
  if (selections.length === 0) return;
  if (!view) return;
  const startLeft = selections[0].getBoundingClientRect().left;
  const startWidth = Number(selections[0].style.width.split('px')[0]);
  const endWidth = Number(
    selections[selections.length - 1].style.width.split('px')[0]
  );
  const endLeft =
    selections[selections.length - 1].getBoundingClientRect().left;
  let centerCoordLeft: number;
  if (selections.length === 1) {
    centerCoordLeft = startWidth / 2 + startLeft;
  } else {
    centerCoordLeft = (endWidth + endLeft + startLeft) / 2;
  }
  if (centerCoordLeft < 200) {
    toolbarStore.setOpeartionLeft(gutterWidth);
    toolbarStore.setTriangleLeft(centerCoordLeft - gutterWidth - 12);
  }
  if (centerCoordLeft >= 200 && centerCoordLeft <= clientWidth - 344) {
    toolbarStore.setOpeartionLeft(centerCoordLeft - 172);
    toolbarStore.setTriangleLeft(172 - 12);
  }
  if (centerCoordLeft > clientWidth - 344) {
    toolbarStore.setOpeartionLeft(clientWidth - 344);
    toolbarStore.setTriangleLeft(centerCoordLeft - (clientWidth - 344) - 12);
  }
};

// NOTE: 长按 set selection
export const handleLongTapSetSelection = (div: HTMLElement) => {
  let isPreventDefault = false;
  div.addEventListener('touchstart', function (event: TouchEvent) {
    isPreventDefault = false;
    const view = store.getEditorView();
    const touch = event.targetTouches[0];
    const coords = { x: touch.pageX, y: touch.pageY - 10 };
    clearMyTimeout();
    if (store.editable || stores.commonStore.entry === EDockingType.PLAYER) {
      removeSelectionLayerClassname();
      return;
    }
    if (view) {
      const { from, to } = view.state.selection.ranges[0];
      const pos = view.posAtCoords(coords) || 0;
      if (from < pos && to > pos) return;
    }
    myTimer = setTimeout(() => {
      toolbarStore.setVisible(false);
      hideSelectionCursor();
      if (view) {
        const pos = view.posAtCoords(coords) || 0;
        const endLinePos = view.state.doc.lineAt(pos).to; // NOTE: 行末尾 pos
        const lastPosCoords = view.coordsAtPos(view.state.doc.length);
        const posCoords = view.coordsAtPos(pos);
        const isClickBottom =
          lastPosCoords?.bottom && coords.y > lastPosCoords?.bottom + 5; // NOTE: 是否点击的非编辑区域

        head = getBeforePos(pos);
        anchor = getAfterPos(pos);

        if (head === anchor || endLinePos === pos || isClickBottom) {
          // NOTE: 行尾,非编辑区长按时弹出单击操作栏
          if (!posCoords?.left || !posCoords?.top || !lastPosCoords?.left)
            return;
          isPreventDefault = true;
          focusEditorView(view, isClickBottom ? view.state.doc.length : pos);
          toolbarStore.setSingleTouch(true);
          toolbarStore.setVisible(true);
          setOperationPosition(
            isClickBottom ? lastPosCoords.left : posCoords.left,
            posCoords.top
          );
          return;
        } else {
          setSelection(view, head, anchor);
        }
        toolbarStore.setSingleTouch(false);
        setTimeout(() => {
          isPreventDefault = true;
          setSelectionCursorPosition();
          handleSetOperationLeft();
          handleSetOperationTop();
          toolbarStore.setVisible(true);
          showSystemKeyboard(view);
        }, 100);
      }
    }, 500);
  });
  div.addEventListener('touchmove', function (event: TouchEvent) {
    clearMyTimeout();
  });
  div.addEventListener('touchend', function (event: TouchEvent) {
    clearMyTimeout();
    if (isPreventDefault) {
      // FIXED: ios 12 长按后会多触发一次 click事件
      event.preventDefault();
    }
  });
};

export function addSystemCursorClass() {
  const cursor: HTMLDivElement | null = document.querySelector('.cm-cursor');
  if (cursor) {
    cursor.classList.add('display-none');
  }
}

export function removeSystemCursorClass() {
  const cursor: HTMLDivElement | null = document.querySelector('.cm-cursor');
  if (cursor) {
    cursor.classList.remove('display-none');
  }
}

export function showSystemKeyboard(view: EditorView) {
  if (store.editable) {
    // NOTE: 出现系统键盘
    const cursorInput: HTMLInputElement | null = document.getElementById(
      'cursorInput'
    ) as HTMLInputElement;
    if (cursorInput) {
      cursorInput.focus();
    } else {
      focusEditorView(view);
    }
    addSystemCursorClass();
  }
}

export const hideSelectionCursor = () => {
  store.setCursorLeftX(-100);
  store.setCursorRightX(-100);
};

function setOperationPosition(posLeft: number, posTop: number) {
  const { width: clientWidth } = getClientSize();
  const headerHeight = stores.configStore.headerHeight;
  const gutter: HTMLDivElement | null = document.querySelector('.cm-gutters');
  let gutterWidth = 32;
  if (gutter) {
    gutterWidth = gutter.getBoundingClientRect().width;
  }
  if (posLeft < 200) {
    // NOTE: 光标left小于200, 操作台left固定在gutters
    if (posLeft <= 40) {
      toolbarStore.setTriangleLeft(posLeft - gutterWidth);
    } else {
      toolbarStore.setTriangleLeft(posLeft - gutterWidth - 11);
    }
    toolbarStore.setOpeartionLeft(gutterWidth);
  }
  if (posLeft >= 200 && posLeft <= clientWidth - 250) {
    toolbarStore.setOpeartionLeft(posLeft - 75);
    toolbarStore.setTriangleLeft(75 - 11);
  }
  if (posLeft > clientWidth - 250) {
    toolbarStore.setOpeartionLeft(clientWidth - 250);
    toolbarStore.setTriangleLeft(posLeft - (clientWidth - 250) - 11);
  }
  toolbarStore.setOpeartionTop(
    posTop - 65 - headerHeight <= 0
      ? posTop + 35 - headerHeight
      : posTop - 55 - headerHeight
  );
  toolbarStore.setIsTriangleBottom(posTop - 65 - headerHeight > 0);
}

let count = 0;
export const handleEditorClick = (e: React.MouseEvent) => {
  if (stores.configStore.disabledSelfResearchEditorSelection) return;

  count += 1;
  const coords = { x: e.pageX, y: e.pageY };
  const { height: clientHeight } = getClientSize();
  const view = store.getEditorView();

  showVirtualKeyboard();
  removeSystemCursorClass();

  if (view) {
    const { from, to } = view.state.selection.ranges[0];
    const pos = view.posAtCoords(coords) || 0;
    const contentLength = view.state.doc.length;
    const lastPosCoords = view.coordsAtPos(contentLength);
    const posCoords = view.coordsAtPos(pos);
    const cursor = view.state.selection.main.head;
    const isClickBottom = !!(
      lastPosCoords?.bottom && coords.y > lastPosCoords?.bottom + 5
    ); // NOTE: 是否点击的非编辑区域

    if (from !== to) {
      if (from <= pos && to >= pos) {
        // NOTE: 如果有 selection, 点击 selection 出现操作栏, 不 focusEditorView
        const toCoords = view.coordsAtPos(to);
        const fromCoords = view.coordsAtPos(from);
        toolbarStore.setIsTriangleBottom(coords.y - 65 > 0);
        toolbarStore.setSingleTouch(false);
        if (toCoords?.bottom) {
          const scroll: HTMLElement | null =
            document.querySelector('.cm-scroller');
          const selections: NodeListOf<HTMLElement> | null =
            document.querySelectorAll('.cm-selectionBackground');
          const lastSelectionTop = virtualKeyboardStore.visible
            ? selections[selections.length - 1].getBoundingClientRect().top + 62
            : selections[selections.length - 1].getBoundingClientRect().top;
          if (
            coords.y > toCoords.bottom ||
            (toCoords.top === fromCoords?.top && coords.x > toCoords.right)
          ) {
            // NOTE: 有selection时, 点击位置不在选择范围内
            isClickBottomFocusEditorView(
              view,
              contentLength,
              pos,
              !!isClickBottom
            );
            toolbarStore.setVisible(false);
            hideSelectionCursor();
          } else {
            handleSetOperationTop();
            toolbarStore.setVisible(!toolbarStore.visible);
          }
          if (scroll && lastSelectionTop > clientHeight) {
            // NOTE: 选择内容超过一屏,尾光标不在屏幕范围内时,滑到尾光标的位置
            view.scrollPosIntoView(to);
            setTimeout(() => {
              scroll.scrollTop = scroll.scrollTop + 100;
              handleSetOperationTop();
              toolbarStore.setVisible(true);
              // NOTE: 滑动过程中 selection元素改变，需重新绑定事件
              setSelectionCursorPosition();
            }, 10);
          }
        }
      } else {
        hideSelectionCursor();
        isClickBottomFocusEditorView(view, contentLength, pos, !!isClickBottom);
        toolbarStore.setVisible(false);
      }
    } else {
      // NOTE: 没有 selection
      if (
        ((pos === from && pos === to) ||
          (cursor === contentLength && isClickBottom)) &&
        count > 1 && // NOTE: 第一次点击不出现操作台
        virtualKeyboardStore.visible // NOTE: 自研键盘不显示时不出现操作台
      ) {
        if (
          posCoords?.bottom &&
          posCoords?.left &&
          posCoords?.top &&
          lastPosCoords?.left
        ) {
          // NOTE: 点击光标出现操作栏, 使用光标的left, 不使用点击的x,因为会不准
          setOperationPosition(
            isClickBottom ? lastPosCoords.left : posCoords.left,
            posCoords.top
          );
          toolbarStore.setVisible(!toolbarStore.visible);
          toolbarStore.setSingleTouch(true);
        }
      } else {
        toolbarStore.setVisible(false);
        hideSelectionCursor();
      }
      hideSelectionCursor();
      isClickBottomFocusEditorView(view, contentLength, pos, !!isClickBottom);
    }
  }
};

function isClickBottomFocusEditorView(
  view: EditorView,
  end: number,
  pos: number,
  isClickBottom: boolean
) {
  if (isClickBottom) {
    // NOTE: 点击非编辑行空白区域，光标移到编辑区最尾端
    focusEditorView(view, end);
  } else {
    focusEditorView(view, pos);
  }
}

// NOTE: 取消选择
export const deselect = (e: React.MouseEvent) => {
  if (!isMobile()) return;
  const view = store.getEditorView();
  const coords = { x: e.pageX, y: e.pageY };
  if (view) {
    const { from, to } = view.state.selection.ranges[0];
    const pos = view.posAtCoords(coords) || 0;
    if (from !== to) {
      focusEditorView(view, pos);
      toolbarStore.setVisible(false);
      hideSelectionCursor();
    }
  }
};

// NOTE: 拖动出现光标
export const handleCursorTouch = (div: HTMLElement) => {
  let startX: number;
  div.addEventListener('touchstart', function (event: TouchEvent) {
    const touch = event.targetTouches[0];
    const coords = { x: touch.pageX, y: touch.pageY };
    startX = coords.x;
  });
  div.addEventListener(
    'touchmove',
    function (event: TouchEvent) {
      toolbarStore.setVisible(false);
      hideSelectionCursor();
      const touch = event.targetTouches[0];
      const coords = { x: touch.pageX, y: touch.pageY - 60 };
      const cmCursor: HTMLElement | null = document.querySelector('.cm-cursor');
      if (cmCursor) {
        const cursorLeft = Number(cmCursor.style.left.split('px')[0]);
        if (
          Math.abs(startX - cursorLeft) < 15 &&
          window.getComputedStyle(cmCursor).display !== 'none'
        ) {
          canDrag = true;
          store.setCursorVisible(true);
        }
      }
      if (!canDrag) return;
      event.preventDefault();
      event.stopPropagation();
      const view = store.getEditorView();
      if (view) {
        const pos = view.posAtCoords(coords);
        focusEditorView(view, pos);
      }
      const cursor: HTMLElement | null = document.getElementById('cursor');
      const lineHeight = Number(store.fontSize.split('px')[0]);
      if (cursor) {
        cursor.style.height = lineHeight * 1.8 + 'px';
        cursor.style.left = coords.x + 'px';
        cursor.style.top = coords.y + 'px';
      }
    },
    false
  );
  div.addEventListener('touchend', function (event: TouchEvent) {
    canDrag = false;
    store.setCursorVisible(false);
  });
  div.addEventListener('touchcancel', function (event: TouchEvent) {
    canDrag = false;
    store.setCursorVisible(false);
  });
};

/**
 * 触底反弹：当 activeLine 聚焦在可编辑区域外时，需要将其回弹到可编辑区底部。
 *
 * 可编辑区域 = 整个编辑区 - Toolbar高度
 */
export const handleEditorBottomingOut = () => {
  const toolbar = toolBarStore.getToolbarDiv();
  if (!toolbar) return;
  const view = store.getEditorView()?.dom;
  const content = view?.querySelector('.cm-content');
  const scroller = content?.parentElement;
  if (!content || !scroller) return;
  const getLastActiveLine = () => {
    const lines: NodeListOf<HTMLElement> | undefined =
      content.querySelectorAll('.cm-activeLine');
    return lines?.[lines.length - 1];
  };
  const rebounding = () => {
    const line = getLastActiveLine();
    if (!line) return;
    const { bottom: lineBottom } = line.getBoundingClientRect();
    const { top: toolbarTop } = toolbar.getBoundingClientRect();
    const offset = lineBottom - toolbarTop;
    if (offset > 0) {
      scroller.scrollTop += offset;
    }
  };
  const filterKeyRebounding = (e: Event) => {
    if (!(e instanceof KeyboardEvent)) return;
    if (
      e.key === 'Backspace' ||
      (e.key === 'Tab' && !(e.metaKey || e.altKey || e.ctrlKey)) ||
      (e.key === 'Enter' && !(e.metaKey || e.altKey || e.ctrlKey))
    ) {
      rebounding();
    }
  };
  content.addEventListener('mousedown', rebounding);
  content.addEventListener('keypress', rebounding);
  content.addEventListener('keydown', filterKeyRebounding);
};

// NOTE: 65000 是 256 * 256 的估值
export const maxFileContentSize = 65000;
export function checkIfHasCutEditorViewContent(view?: EditorView) {
  if (view) {
    const content = getContentFromEditorView(view);
    const newContent = checkTextByteLimit(content, maxFileContentSize);
    if (newContent) {
      undoContentToEditorView(view, newContent);
      return true;
    }
  }
}

export function showCutEditorViewContentNotification() {
  const { language } = stores.commonStore;
  const title = formatMessageWithoutReact(
    language,
    'project.fileContentSizeLimitTitle'
  );
  const tips = formatMessageWithoutReact(
    language,
    'project.fileContentSizeLimitTips'
  );
  showNotification(title, tips);
}

export function getLinesIndentGuides(
  startLineNumber: number,
  endLineNumber: number,
  view: Transaction
) {
  const lineCount = view.state.doc.lines;
  const tabSize = view.state.tabSize;
  if (startLineNumber > lineCount || endLineNumber > lineCount) {
    throw new Error('Illegal value for startLineNumber');
  }
  const result = new Array(endLineNumber - startLineNumber + 1);
  let aboveContentLineIndex =
    -2; /* -2 is a marker for not having computed it */
  let aboveContentLineIndent = -1;
  let belowContentLineIndex =
    -2; /* -2 is a marker for not having computed it */
  let belowContentLineIndent = -1;
  for (
    let lineNumber = startLineNumber;
    lineNumber <= endLineNumber;
    lineNumber++
  ) {
    const resultIndex = lineNumber - startLineNumber;
    const currentIndent = computeIndentLevel(
      view.state.doc.line(lineNumber).text,
      view.state.tabSize
    );
    if (currentIndent >= 0) {
      // This line has content (besides whitespace)
      // Use the line's indent
      aboveContentLineIndex = lineNumber - 1;
      aboveContentLineIndent = currentIndent;
      result[resultIndex] = Math.ceil(currentIndent / tabSize);
      continue;
    }
    if (aboveContentLineIndex === -2) {
      aboveContentLineIndex = -1;
      aboveContentLineIndent = -1;
      // must find previous line with content
      for (let lineIndex = lineNumber - 2; lineIndex >= 0; lineIndex--) {
        const indent = computeIndentLevel(
          view.state.doc.line(lineIndex + 1).text,
          view.state.tabSize
        );
        if (indent >= 0) {
          aboveContentLineIndex = lineIndex;
          aboveContentLineIndent = indent;
          break;
        }
      }
    }
    if (
      belowContentLineIndex !== -1 &&
      (belowContentLineIndex === -2 || belowContentLineIndex < lineNumber - 1)
    ) {
      belowContentLineIndex = -1;
      belowContentLineIndent = -1;
      // must find next line with content
      for (let lineIndex = lineNumber; lineIndex < lineCount; lineIndex++) {
        const indent = computeIndentLevel(
          view.state.doc.line(lineIndex + 1).text,
          view.state.tabSize
        );
        if (indent >= 0) {
          belowContentLineIndex = lineIndex;
          belowContentLineIndent = indent;
          break;
        }
      }
    }
    result[resultIndex] = getIndentLevelForWhitespaceLine(
      true,
      aboveContentLineIndent,
      belowContentLineIndent,
      view.state.tabSize
    );
  }
  return result;
}

function computeIndentLevel(line: string, tabSize: number) {
  let indent = 0;
  let i = 0;
  const len = line.length;
  while (i < len) {
    const chCode = line.charCodeAt(i);
    if (chCode === 32 /* Space */) {
      indent++;
    } else if (chCode === 9 /* Tab */) {
      indent = indent - (indent % tabSize) + tabSize;
    } else {
      break;
    }
    i++;
  }
  if (i === len) {
    return -1; // line only consists of whitespace
  }
  return indent;
}

function getIndentLevelForWhitespaceLine(
  offSide: boolean,
  aboveContentLineIndent: number,
  belowContentLineIndent: number,
  tabSize: number
) {
  if (aboveContentLineIndent === -1 || belowContentLineIndent === -1) {
    // At the top or bottom of the file
    return 0;
  } else if (aboveContentLineIndent < belowContentLineIndent) {
    // we are inside the region above
    return 1 + Math.floor(aboveContentLineIndent / tabSize);
  } else if (aboveContentLineIndent === belowContentLineIndent) {
    // we are in between two regions
    return Math.ceil(belowContentLineIndent / tabSize);
  } else {
    if (offSide) {
      // same level as region below
      return Math.ceil(belowContentLineIndent / tabSize);
    } else {
      // we are inside the region that ends below
      return 1 + Math.floor(belowContentLineIndent / tabSize);
    }
  }
}

export function getActiveIndentGuide(
  lineNumber: number,
  minLineNumber: number,
  maxLineNumber: number,
  view: Transaction
) {
  const lineCount = view.state.doc.lines;
  const tabSize = view.state.tabSize;
  if (lineNumber > lineCount) {
    throw new Error('Illegal value for lineNumber');
  }
  const offSide = true;
  let upAboveContentLineIndex =
    -2; /* -2 is a marker for not having computed it */
  let upAboveContentLineIndent = -1;
  let upBelowContentLineIndex =
    -2; /* -2 is a marker for not having computed it */
  let upBelowContentLineIndent = -1;
  const upResolveIndents = function (lineNumber1: number) {
    if (
      upAboveContentLineIndex !== -1 &&
      (upAboveContentLineIndex === -2 ||
        upAboveContentLineIndex > lineNumber1 - 1)
    ) {
      upAboveContentLineIndex = -1;
      upAboveContentLineIndent = -1;
      // must find previous line with content
      for (let lineIndex = lineNumber1 - 2; lineIndex >= 0; lineIndex--) {
        const indent1 = computeIndentLevel(
          view.state.doc.line(lineIndex + 1).text,
          tabSize
        );
        if (indent1 >= 0) {
          upAboveContentLineIndex = lineIndex;
          upAboveContentLineIndent = indent1;
          break;
        }
      }
    }
    if (upBelowContentLineIndex === -2) {
      upBelowContentLineIndex = -1;
      upBelowContentLineIndent = -1;
      // must find next line with content
      for (let lineIndex = lineNumber1; lineIndex < lineCount; lineIndex++) {
        const indent2 = computeIndentLevel(
          view.state.doc.line(lineIndex + 1).text,
          tabSize
        );
        if (indent2 >= 0) {
          upBelowContentLineIndex = lineIndex;
          upBelowContentLineIndent = indent2;
          break;
        }
      }
    }
  };
  let downAboveContentLineIndex =
    -2; /* -2 is a marker for not having computed it */
  let downAboveContentLineIndent = -1;
  let downBelowContentLineIndex =
    -2; /* -2 is a marker for not having computed it */
  let downBelowContentLineIndent = -1;
  const downResolveIndents = function (lineNumber2: number) {
    if (downAboveContentLineIndex === -2) {
      downAboveContentLineIndex = -1;
      downAboveContentLineIndent = -1;
      // must find previous line with content
      for (let lineIndex = lineNumber2 - 2; lineIndex >= 0; lineIndex--) {
        const indent3 = computeIndentLevel(
          view.state.doc.line(lineIndex + 1).text,
          tabSize
        );
        if (indent3 >= 0) {
          downAboveContentLineIndex = lineIndex;
          downAboveContentLineIndent = indent3;
          break;
        }
      }
    }
    if (
      downBelowContentLineIndex !== -1 &&
      (downBelowContentLineIndex === -2 ||
        downBelowContentLineIndex < lineNumber2 - 1)
    ) {
      downBelowContentLineIndex = -1;
      downBelowContentLineIndent = -1;
      // must find next line with content
      for (let lineIndex = lineNumber2; lineIndex < lineCount; lineIndex++) {
        const indent4 = computeIndentLevel(
          view.state.doc.line(lineIndex + 1).text,
          tabSize
        );
        if (indent4 >= 0) {
          downBelowContentLineIndex = lineIndex;
          downBelowContentLineIndent = indent4;
          break;
        }
      }
    }
  };
  let startLineNumber = 0;
  let goUp = true;
  let endLineNumber = 0;
  let goDown = true;
  let indent = 0;
  for (let distance = 0; goUp || goDown; distance++) {
    const upLineNumber = lineNumber - distance;
    const downLineNumber = lineNumber + distance;
    if (distance !== 0 && (upLineNumber < 1 || upLineNumber < minLineNumber)) {
      goUp = false;
    }
    if (
      distance !== 0 &&
      (downLineNumber > lineCount || downLineNumber > maxLineNumber)
    ) {
      goDown = false;
    }
    if (distance > 50000) {
      // stop processing
      goUp = false;
      goDown = false;
    }
    if (goUp) {
      // compute indent level going up
      let upLineIndentLevel = void 0 as any;
      const currentIndent = computeIndentLevel(
        view.state.doc.line(upLineNumber).text,
        tabSize
      );
      if (currentIndent >= 0) {
        // This line has content (besides whitespace)
        // Use the line's indent
        upBelowContentLineIndex = upLineNumber - 1;
        upBelowContentLineIndent = currentIndent;
        upLineIndentLevel = Math.ceil(currentIndent / tabSize);
      } else {
        upResolveIndents(upLineNumber);
        upLineIndentLevel = getIndentLevelForWhitespaceLine(
          offSide,
          upAboveContentLineIndent,
          upBelowContentLineIndent,
          tabSize
        );
      }
      if (distance === 0) {
        // This is the initial line number
        startLineNumber = upLineNumber;
        endLineNumber = downLineNumber;
        indent = upLineIndentLevel;
        if (indent === 0) {
          // No need to continue
          return {
            startLineNumber: startLineNumber,
            endLineNumber: endLineNumber,
            indent: indent,
          };
        }
        continue;
      }
      if (upLineIndentLevel >= indent) {
        startLineNumber = upLineNumber;
      } else {
        goUp = false;
      }
    }
    if (goDown) {
      // compute indent level going down
      let downLineIndentLevel = void 0 as any;
      const currentIndent = computeIndentLevel(
        view.state.doc.line(downLineNumber).text,
        tabSize
      );
      if (currentIndent >= 0) {
        // This line has content (besides whitespace)
        // Use the line's indent
        downAboveContentLineIndex = downLineNumber - 1;
        downAboveContentLineIndent = currentIndent;
        downLineIndentLevel = Math.ceil(currentIndent / tabSize);
      } else {
        downResolveIndents(downLineNumber);
        downLineIndentLevel = getIndentLevelForWhitespaceLine(
          offSide,
          downAboveContentLineIndent,
          downBelowContentLineIndent,
          tabSize
        );
      }
      if (downLineIndentLevel >= indent) {
        endLineNumber = downLineNumber;
      } else {
        goDown = false;
      }
    }
  }
  return {
    startLineNumber: startLineNumber,
    endLineNumber: endLineNumber,
    indent: indent,
  };
}
