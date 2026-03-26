import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { DataTable, createColumnHelper } from "./data-table";

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface Fruit {
  id: number;
  name: string;
  color: string;
}

const fruits: Fruit[] = [
  { id: 1, name: "Apple", color: "red" },
  { id: 2, name: "Banana", color: "yellow" },
  { id: 3, name: "Cherry", color: "red" },
  { id: 4, name: "Date", color: "brown" },
  { id: 5, name: "Elderberry", color: "purple" },
];

const helper = createColumnHelper<Fruit>();
const columns = [
  helper.accessor("name", { header: "Name" }),
  helper.accessor("color", { header: "Color" }),
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DataTable — Core Rendering", () => {
  it("renders column headers and data rows with minimal props", () => {
    render(<DataTable columns={columns} data={fruits} />);

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Color")).toBeInTheDocument();
    fruits.forEach((f) => {
      expect(screen.getByText(f.name)).toBeInTheDocument();
    });
  });

  it("renders default empty state when data is empty", () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });

  it("renders custom empty state when provided", () => {
    render(<DataTable columns={columns} data={[]} empty={<span>Nothing here</span>} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("shows skeletons and hides data rows when loading=true", () => {
    render(<DataTable columns={columns} data={fruits} loading loadingRowCount={3} />);

    // Data should not be visible
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();

    // Skeletons rendered: 3 rows × 2 columns = 6 skeleton divs
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBe(6);
  });

  it("still renders the header while loading", () => {
    render(<DataTable columns={columns} data={fruits} loading />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });
});

describe("DataTable — Sorting", () => {
  it("does NOT sort when sorting prop is omitted", async () => {
    render(<DataTable columns={columns} data={fruits} />);
    const nameHeader = screen.getByText("Name");

    await userEvent.click(nameHeader);

    // Rows stay in original insertion order
    const cells = screen.getAllByRole("cell");
    const nameCells = cells.filter((_, i) => i % 2 === 0);
    expect(nameCells[0]).toHaveTextContent("Apple");
  });

  it("sorts ascending on first header click", async () => {
    const unsorted: Fruit[] = [
      { id: 1, name: "Zebra", color: "black" },
      { id: 2, name: "Apple", color: "red" },
      { id: 3, name: "Mango", color: "orange" },
    ];
    render(<DataTable columns={columns} data={unsorted} sorting />);

    await userEvent.click(screen.getByText("Name"));

    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(within(rows[0]).getByText("Apple")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Mango")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Zebra")).toBeInTheDocument();
  });

  it("sorts descending on second header click", async () => {
    const unsorted: Fruit[] = [
      { id: 1, name: "Zebra", color: "black" },
      { id: 2, name: "Apple", color: "red" },
    ];
    render(<DataTable columns={columns} data={unsorted} sorting />);

    const nameHeader = screen.getByText("Name");
    await userEvent.click(nameHeader);
    await userEvent.click(nameHeader);

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Zebra")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Apple")).toBeInTheDocument();
  });
});

describe("DataTable — Global Filter", () => {
  it("does not render search input when globalFilter is omitted", () => {
    render(<DataTable columns={columns} data={fruits} />);
    expect(screen.queryByPlaceholderText(/filtrar/i)).not.toBeInTheDocument();
  });

  it("renders search input when globalFilter=true", () => {
    render(<DataTable columns={columns} data={fruits} globalFilter />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("filters rows by typed query (case-insensitive)", async () => {
    render(<DataTable columns={columns} data={fruits} globalFilter />);

    await userEvent.type(screen.getByRole("textbox"), "apple");

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.queryByText("Banana")).not.toBeInTheDocument();
    expect(screen.queryByText("Cherry")).not.toBeInTheDocument();
  });

  it("shows all rows when filter is cleared", async () => {
    render(<DataTable columns={columns} data={fruits} globalFilter />);
    const input = screen.getByRole("textbox");

    await userEvent.type(input, "apple");
    await userEvent.clear(input);

    fruits.forEach((f) => {
      expect(screen.getByText(f.name)).toBeInTheDocument();
    });
  });
});

describe("DataTable — Pagination", () => {
  it("shows all rows when pagination is disabled", () => {
    render(<DataTable columns={columns} data={fruits} />);
    fruits.forEach((f) => expect(screen.getByText(f.name)).toBeInTheDocument());
  });

  it("limits visible rows to pageSize when pagination is enabled", () => {
    render(<DataTable columns={columns} data={fruits} pagination={{ pageSize: 2 }} />);

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText("Cherry")).not.toBeInTheDocument();
  });

  it("renders pagination controls when pagination is enabled", () => {
    render(<DataTable columns={columns} data={fruits} pagination={{ pageSize: 2 }} />);
    expect(screen.getByText(/page 1 of/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prev/i })).toBeInTheDocument();
  });

  it("navigates to next page on Next click", async () => {
    render(<DataTable columns={columns} data={fruits} pagination={{ pageSize: 2 }} />);

    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText("Cherry")).toBeInTheDocument();
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
  });

  it("disables Prev on first page and Next on last page", async () => {
    render(<DataTable columns={columns} data={fruits} pagination={{ pageSize: 3 }} />);

    const prev = screen.getByRole("button", { name: /prev/i });
    expect(prev).toBeDisabled();

    // Navigate to last page
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });
});

describe("DataTable — Row Click", () => {
  it("calls onRowClick with the row's data when a row is clicked", async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={fruits} onRowClick={onRowClick} />);

    await userEvent.click(screen.getByText("Apple"));

    expect(onRowClick).toHaveBeenCalledWith(fruits[0]);
  });

  it("applies cursor-pointer to rows when onRowClick is provided", () => {
    render(<DataTable columns={columns} data={fruits} onRowClick={vi.fn()} />);
    const rows = screen.getAllByRole("row").slice(1);
    rows.forEach((row) => {
      expect(row.className).toContain("cursor-pointer");
    });
  });
});

describe("DataTable — Row ClassName", () => {
  it("applies custom class to rows matching getRowClassName", () => {
    render(
      <DataTable
        columns={columns}
        data={fruits}
        getRowClassName={(row) => (row.color === "red" ? "bg-red-100" : undefined)}
      />
    );

    const rows = screen.getAllByRole("row").slice(1);
    const appleRow = rows.find((r) => within(r).queryByText("Apple"));
    const bananaRow = rows.find((r) => within(r).queryByText("Banana"));

    expect(appleRow?.className).toContain("bg-red-100");
    expect(bananaRow?.className).not.toContain("bg-red-100");
  });
});

describe("DataTable — Toolbar Slot", () => {
  it("renders toolbar content above the table", () => {
    render(<DataTable columns={columns} data={fruits} toolbar={<button>Export</button>} />);
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("renders both toolbar and search input when globalFilter is also enabled", () => {
    render(
      <DataTable columns={columns} data={fruits} globalFilter toolbar={<button>Export</button>} />
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });
});

describe("DataTable — Row Selection", () => {
  it("does not render checkbox column when rowSelection is omitted", () => {
    render(<DataTable columns={columns} data={fruits} />);
    const checkboxes = screen.queryAllByRole("checkbox");
    expect(checkboxes).toHaveLength(0);
  });

  it("renders checkbox column when rowSelection is provided", () => {
    render(
      <DataTable columns={columns} data={fruits} rowSelection={{ onSelectionChange: vi.fn() }} />
    );
    // 1 header + 5 row checkboxes
    expect(screen.getAllByRole("checkbox")).toHaveLength(fruits.length + 1);
  });

  it("calls onSelectionChange with selected rows when a row is checked", async () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={fruits}
        rowSelection={{ onSelectionChange }}
        getRowId={(row) => String(row.id)}
      />
    );

    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[1]); // first data row

    expect(onSelectionChange).toHaveBeenCalledWith([fruits[0]]);
  });

  it("calls onSelectionChange with all rows when header checkbox is checked", async () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={fruits}
        rowSelection={{ onSelectionChange }}
        getRowId={(row) => String(row.id)}
      />
    );

    const headerCheckbox = screen.getAllByRole("checkbox")[0];
    await userEvent.click(headerCheckbox);

    const lastCall = onSelectionChange.mock.calls.at(-1)?.[0] as Fruit[];
    expect(lastCall).toHaveLength(fruits.length);
  });
});
