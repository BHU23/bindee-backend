import { ZodError } from "zod";
import {
  AppError,
  InventoryUnavailableError,
} from "../../../core/errors/index.js";

/** Lets domain and validation errors through and turns infrastructure failures into INVENTORY_UNAVAILABLE. */
export async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    throw new InventoryUnavailableError(undefined, error);
  }
}
