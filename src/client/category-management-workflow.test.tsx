// @vitest-environment jsdom

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, renderApp, resetClientTestState } from "./test-utils";

afterEach(resetClientTestState);

describe("Manage categories", () => {
  it("creates, preserves a failed rename, reorders, and removes with reassignment", async () => {
    let categories = [
      {
        id: 1,
        name: "Kitchen",
        position: 0,
        activeTaskCount: 1,
      },
      { id: 2, name: "Garden", position: 1, activeTaskCount: 0 },
    ];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("state=ready") || url.includes("state=sleeping")) {
          return jsonResponse({ tasks: [] });
        }
        if (url === "/api/categories" && !init?.method) {
          return jsonResponse({ categories });
        }
        if (url === "/api/categories" && init?.method === "POST") {
          const name = (JSON.parse(String(init.body)) as { name: string }).name;
          const created = {
            id: 3,
            name,
            position: categories.length,
            activeTaskCount: 0,
          };
          categories = [...categories, created];
          return jsonResponse(created, 201);
        }
        if (url === "/api/categories/2" && init?.method === "PATCH") {
          const name = (JSON.parse(String(init.body)) as { name: string }).name;
          if (name === "Kitchen") {
            return jsonResponse(
              {
                error: {
                  code: "CATEGORY_NAME_CONFLICT",
                  message: "A category with that name already exists",
                  fields: { name: "Choose a different category name" },
                },
              },
              409,
            );
          }
          categories = categories.map((category) =>
            category.id === 2 ? { ...category, name } : category,
          );
          return jsonResponse(categories.find(({ id }) => id === 2));
        }
        if (url === "/api/categories/order" && init?.method === "PUT") {
          const ids = (
            JSON.parse(String(init.body)) as { categoryIds: number[] }
          ).categoryIds;
          categories = ids.map((id, position) => ({
            ...categories.find((category) => category.id === id)!,
            position,
          }));
          return jsonResponse({ categories });
        }
        if (
          url === "/api/categories/1?replacementCategoryId=2" &&
          init?.method === "DELETE"
        ) {
          categories = categories
            .filter(({ id }) => id !== 1)
            .map((category, position) => ({
              ...category,
              position,
              activeTaskCount:
                category.id === 2 ? category.activeTaskCount + 1 : 0,
            }));
          return jsonResponse({ categories });
        }
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "No" } },
          404,
        );
      });

    renderApp("/categories/manage");
    await screen.findByRole("heading", { name: "Manage categories" });
    expect(await screen.findByText("1 active task")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("New category"), "Admin");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("heading", { name: "Admin" });

    const gardenRow = screen
      .getByRole("heading", { name: "Garden" })
      .closest("li")!;
    await userEvent.click(
      within(gardenRow).getByRole("button", { name: "Rename" }),
    );
    const renameInput = within(gardenRow).getByLabelText("Category name");
    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "Kitchen");
    await userEvent.click(
      within(gardenRow).getByRole("button", { name: "Save" }),
    );
    expect(
      await screen.findByText("Choose a different category name"),
    ).toBeTruthy();
    expect((renameInput as HTMLInputElement).value).toBe("Kitchen");

    await userEvent.clear(renameInput);
    await userEvent.type(renameInput, "Outdoors");
    await userEvent.click(
      within(gardenRow).getByRole("button", { name: "Save" }),
    );
    await screen.findByRole("heading", { name: "Outdoors" });

    await userEvent.click(
      screen.getByRole("button", { name: "Move Admin up" }),
    );
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("heading", { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(["Kitchen", "Admin", "Outdoors"]);
    });

    const kitchenRow = screen
      .getByRole("heading", { name: "Kitchen" })
      .closest("li")!;
    await userEvent.click(
      within(kitchenRow).getByRole("button", { name: "Remove" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Move tasks to"), "2");
    await userEvent.click(
      screen.getByRole("button", { name: "Remove category" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Kitchen" })).toBeNull(),
    );
    expect(screen.getByText("1 active task")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/categories/1?replacementCategoryId=2" &&
          init?.method === "DELETE",
      ),
    ).toBe(true);
  });
});
