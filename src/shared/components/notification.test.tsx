import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationCard } from "./notification";

describe("NotificationCard", () => {
  it("shows message, detail, source and runs an action before dismissing", () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    render(
      <NotificationCard
        level="error"
        message="No se pudo activar acme.x"
        detail="boom"
        source="Extension Host"
        actions={[{ label: "Reintentar", primary: true, onClick: onRetry }]}
        onDismiss={onDismiss}
      />
    );
    const card = screen.getByRole("alert");
    expect(card).toHaveAttribute("data-notification", "error");
    expect(card).toHaveTextContent("No se pudo activar acme.x");
    expect(card).toHaveTextContent("boom");
    expect(card).toHaveTextContent("Origen: Extension Host");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses a status role for non-errors and closes from the X", () => {
    const onDismiss = vi.fn();
    render(<NotificationCard level="info" message="Listo" onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Listo");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar notificación" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
