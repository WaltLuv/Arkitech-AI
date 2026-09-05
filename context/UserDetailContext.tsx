/**
 * React context that shares the current database-backed user profile across client components.
 */
import { createContext } from "react";

export const UserDetailContext = createContext<any>(null);