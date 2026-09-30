/** Generic response envelope for APIs and other structured service results. */
export interface ApiResponse<T = unknown> {
    code: number;
    message: string;
    data: T;
}

/** Zero-based or one-based paging values as defined by the consuming API. */
export interface PageParams {
    page: number;
    pageSize: number;
}

/** A page of records paired with the parameters used to obtain it. */
export interface PageResult<T> {
    list: T[];
    total: number;
    page: number;
    pageSize: number;
}

/** Marks a value that may be absent as `null`, without permitting `undefined`. */
export type Nullable<T> = T | null;

/** Recursively makes known object properties optional for patch-style data. */
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
