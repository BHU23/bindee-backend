import {
  AppError,
  InventoryUnavailableError,
} from "../../../core/errors/index.js";

/** Lets domain errors through and turns infrastructure failures into INVENTORY_UNAVAILABLE. */
export async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new InventoryUnavailableError(undefined, error);
  }
}
