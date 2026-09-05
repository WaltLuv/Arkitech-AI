/**
 * React context that shares the current database-backed user profile across client components.
 */
import { createContext } from "react";

export type UserDetail = {
    id: number;
    name: string | null;
    email: string;
    agentCredits: number | null;
    usageCredits: number | null;
    createdAt: string;
};

export type UserDetailContextValue = {
    userDetail: UserDetail | UserDetail[] | undefined;
    setUserDetail: (user: UserDetail | UserDetail[] | undefined) => void;
};

export const UserDetailContext = createContext<UserDetailContextValue>({
    userDetail: undefined,
    setUserDetail: () => {},
});