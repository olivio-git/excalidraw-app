import { EditorSelection, type StateCommand } from "@codemirror/state";

/**
 * Toggle an inline marker (`**`, `*`, `` ` ``, `~~`) around each selection.
 * With an empty selection the markers are inserted and the cursor placed
 * between them; an already wrapped selection is unwrapped.
 */
export function toggleInline(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const size = marker.length;
    const changes = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - size, range.from);
      const after = state.sliceDoc(range.to, range.to + size);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - size, to: range.from },
            { from: range.to, to: range.to + size },
          ],
          range: EditorSelection.range(range.from - size, range.to - size),
        };
      }
      const text = state.sliceDoc(range.from, range.to);
      if (text.length >= size * 2 && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(size, -size) },
          range: EditorSelection.range(range.from, range.to - size * 2),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + size, range.to + size),
      };
    });
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/** Wrap the selection as a link (`[texto](url)`) and select the URL placeholder. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to) || "texto";
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/** Toggle a task item's checkbox at `pos` (`- [ ]` ⇄ `- [x]`). */
export const toggleTaskAt = (markerFrom: number): StateCommand => {
  return ({ state, dispatch }) => {
    const marker = state.sliceDoc(markerFrom, markerFrom + 3);
    if (!/^\[[ xX]\]$/.test(marker)) return false;
    const checked = marker[1] !== " ";
    dispatch(
      state.update({
        changes: { from: markerFrom + 1, to: markerFrom + 2, insert: checked ? " " : "x" },
        userEvent: "input.toggle",
      })
    );
    return true;
  };
};
