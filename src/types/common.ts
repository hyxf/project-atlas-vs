export interface ApiResponse<T = unknown> {
    code: number;
    message: string;
    data: T;
}

export interface PageParams {
    page: number;
    pageSize: number;
}

export interface PageResult<T> {
    list: T[];
    total: number;
    page: number;
    pageSize: number;
}

export type Nullable<T> = T | null;

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
