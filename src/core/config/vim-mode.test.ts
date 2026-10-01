import { describe, expect, it } from "vitest";
import { parseVimrc } from "./vim-mode";

describe("vimrc", () => {
  it("reads the leader, map commands and comments", () => {
    const { mappings, problems } = parseVimrc(`" comment
let mapleader = " "
inoremap jk <Esc>
nnoremap <silent> <leader>w :w<CR>
nmap <Leader>ff :qori workbench.action.openQuickOpen<CR>
vmap < <gv`);
    expect(problems).toEqual([]);
    expect(mappings).toEqual([
      { lhs: "jk", rhs: "<Esc>", mode: "insert", recursive: false },
      { lhs: "<Space>w", rhs: ":w<CR>", mode: "normal", recursive: false },
      {
        lhs: "<Space>ff",
        rhs: ":qori workbench.action.openQuickOpen<CR>",
        mode: "normal",
        recursive: true,
      },
      { lhs: "<", rhs: "<gv", mode: "visual", recursive: true },
    ]);
  });

  it("uses backslash as the default leader and a comma when set", () => {
    expect(parseVimrc("nmap <leader>q :q<CR>").mappings[0].lhs).toBe("\\q");
    expect(parseVimrc("let g:mapleader = ','\nnmap <leader>q :q<CR>").mappings[0].lhs).toBe(",q");
  });

  it("reports what it cannot use, with the line", () => {
    const { problems } = parseVimrc("set number\nnmap x");
    expect(problems).toEqual([
      { line: 1, message: "vimrc: «set» no se admite aquí" },
      { line: 2, message: "vimrc: falta la tecla o la acción en «nmap x»" },
    ]);
  });
});
