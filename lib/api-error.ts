/**
 * Turns an unknown thrown value into a message safe to show a user.
 */

/**
 * Axios rejects with an error carrying the server's JSON body on `response.data`.
 * The API routes in this project put their message on `{ error }`, so that is
 * what gets read here before falling back.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== "object" || error === null) return fallback;

    const response = (error as { response?: unknown }).response;
    if (typeof response !== "object" || response === null) return fallback;

    const data = (response as { data?: unknown }).data;
    if (typeof data !== "object" || data === null) return fallback;

    const message = (data as { error?: unknown }).error;
    return typeof message === "string" && message.length > 0 ? message : fallback;
}
