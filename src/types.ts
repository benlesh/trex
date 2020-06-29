/**
 * Copyright 2020 Ben Lesh <ben@benlesh.com>
 * MIT License
 */

export interface Observer<T> {
  next(value: T, signal: AbortSignal): void;
  error(err: any): void;
  complete(): void;
}

export interface Subscriber<T> {
  next(value: T): void;
  error(err: any): void;
  complete(): void;
}
