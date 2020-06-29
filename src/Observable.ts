/**
 * Copyright 2020 Ben Lesh <ben@benlesh.com>
 * MIT License
 */
import { Observer, Subscriber } from "./types";
import { hostReportError } from "./util/hostReportError";
import { chainAbort } from "./util/chainAbort";

type ObserverInit<T> = (subscriber: Subscriber<T>, signal: AbortSignal) => void;

export class Observable<T> {
  static from<T>(input: any): Observable<T> {
    if (typeof input[Symbol.iterator] === "function") {
      return new Observable<T>((subscriber, signal) => {
        const iterator = input[Symbol.iterator]();
        for (const value of iterator) {
          if (signal.aborted) {
            break;
          }
          subscriber.next(value);
        }
        subscriber.complete();
      });
    }

    if (isPromiseLike<T>(input)) {
      return new Observable<T>((subscriber) => {
        input.then(
          (value) => {
            subscriber.next(value);
            subscriber.complete();
          },
          (err) => {
            subscriber.error(err);
          }
        );
      });
    }

    throw new TypeError("Value is not observable");
  }

  static of<T>(...values: T[]): Observable<T> {
    return Observable.from<T>(values);
  }

  static concat<T>(...sources: Observable<T>[]): Observable<T> {
    return Observable.from(sources).concatMap(identity as any);
  }

  static merge<T>(...sources: Observable<T>[]): Observable<T> {
    return Observable.from(sources).mergeMap(identity as any);
  }

  constructor(private _init: ObserverInit<T>) {}

  subscribe(observer: Partial<Observer<T>>, signal?: AbortSignal) {
    const abortController = new AbortController();
    if (signal) {
      chainAbort(signal, abortController);
    }
    const subscriber = new SafeSubscriber(observer, abortController);
    this._init(subscriber, abortController.signal);
  }

  forEach(
    next: (value: T, signal: AbortSignal) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise<void>((complete, error) => {
      this.subscribe(
        {
          next,
          error,
          complete,
        },
        signal
      );
    });
  }

  map<R>(callback: (value: T, index: number) => R): Observable<R> {
    return new Observable<R>((subscriber, signal) => {
      let index = 0;
      this.subscribe(
        {
          next: (value) => {
            let result: R;
            try {
              result = callback(value, index++);
            } catch (err) {
              subscriber.error(err);
              return;
            }
            subscriber.next(result);
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        },
        signal
      );
    });
  }

  filter(callback: (value: T, index: number) => boolean): Observable<T> {
    return new Observable<T>((subscriber, signal) => {
      let index = 0;
      this.subscribe(
        {
          next: (value) => {
            let result: boolean;
            try {
              result = callback(value, index++);
            } catch (err) {
              subscriber.error(err);
              return;
            }
            if (result) {
              subscriber.next(value);
            }
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        },
        signal
      );
    });
  }

  take(count: number): Observable<T> {
    count = Math.max(count, 0);
    return new Observable<T>((subscriber, signal) => {
      let i = 0;
      this.subscribe(
        {
          next: (value) => {
            subscriber.next(value);
            if (++i === count) {
              subscriber.complete();
            }
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        },
        signal
      );
    });
  }

  takeLast(count: number): Observable<T> {
    count = Math.max(count, 0);
    return new Observable<T>((subscriber, signal) => {
      let lastValues: T[] = [];

      this.subscribe(
        {
          next: (value) => {
            lastValues.push(value);
            while (lastValues.length > count) {
              lastValues.shift();
            }
          },
          error: (err) => subscriber.error(err),
          complete: () => {
            const copy = lastValues.slice();
            for (const value of copy) {
              subscriber.next(value);
            }
            subscriber.complete();
          },
        },
        signal
      );
    });
  }

  scan<A>(
    callback: (accumulator: A, value: T, index: number) => A,
    initialValue?: A
  ) {
    const hasInit = arguments.length === 2;
    return new Observable<A>((subscriber, signal) => {
      let state: A = initialValue!;
      let i = 0;
      this.subscribe(
        {
          next: (value) => {
            const index = i++;
            if (!hasInit && index === 0) {
              subscriber.next(value as any);
            }
            try {
              state = callback(state, value, index);
            } catch (err) {
              subscriber.error(err);
              return;
            }
            subscriber.next(state);
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        },
        signal
      );
    });
  }

  takeUntil(notifier: Observable<any>) {
    return new Observable<T>((subscriber, signal) => {
      const abortController = new AbortController();
      chainAbort(signal, abortController);
      this.subscribe(subscriber, abortController.signal);

      notifier.subscribe(
        {
          next: () => {
            subscriber.complete();
            abortController.abort();
          },
          error: (err) => subscriber.error(err),
        },
        signal
      );
    });
  }

  mergeMap<R>(
    callback: (value: T, index: number) => Observable<R>
  ): Observable<R> {
    return new Observable<R>((subscriber, signal) => {
      let index = 0;
      let active = 0;
      let outerComplete = false;
      this.subscribe(
        {
          next: (value) => {
            let result: Observable<R>;
            try {
              result = callback(value, index++);
            } catch (err) {
              subscriber.error(err);
              return;
            }
            active++;
            result.subscribe(
              {
                next: (innerValue) => subscriber.next(innerValue),
                error: (err) => subscriber.error(err),
                complete: () => {
                  active--;
                  if (outerComplete && active === 0) {
                    subscriber.complete();
                  }
                },
              },
              signal
            );
          },
          error: (err) => subscriber.error(err),
          complete: () => {
            outerComplete = true;
            if (active === 0) {
              subscriber.complete();
            }
          },
        },
        signal
      );
    });
  }

  concatMap<R>(
    callback: (value: T, index: number) => Observable<R>
  ): Observable<R> {
    return new Observable<R>((subscriber, signal) => {
      let index = 0;
      let outerComplete = false;
      const buffer: T[] = [];

      const checkSubscribe = () => {
        if (buffer.length > 0) {
          const value = buffer.shift()!;
          let result: Observable<R>;
          try {
            result = callback(value, index++);
          } catch (err) {
            subscriber.error(err);
            return;
          }
          result.subscribe(
            {
              next: (innerValue) => subscriber.next(innerValue),
              error: (err) => subscriber.error(err),
              complete: () => {
                if (outerComplete && buffer.length === 0) {
                  subscriber.complete();
                } else {
                  checkSubscribe();
                }
              },
            },
            signal
          );
        }
      };

      this.subscribe(
        {
          next: (value) => {
            buffer.push(value);
            checkSubscribe();
          },
          error: (err) => subscriber.error(err),
          complete: () => {
            outerComplete = true;
            if (buffer.length === 0) {
              subscriber.complete();
            }
          },
        },
        signal
      );
    });
  }

  switchMap<R>(
    callback: (value: T, index: number) => Observable<R>
  ): Observable<R> {
    return new Observable<R>((subscriber, signal) => {
      let index = 0;
      let outerComplete = false;
      let innerAbortController: AbortController | void = void 0;

      this.subscribe(
        {
          next: (value) => {
            if (innerAbortController) {
              innerAbortController.abort();
              innerAbortController = void 0;
            }

            innerAbortController = new AbortController();
            chainAbort(signal, innerAbortController);
            let result: Observable<R>;
            try {
              result = callback(value, index++);
            } catch (err) {
              subscriber.error(err);
              return;
            }
            result.subscribe(
              {
                next: (innerValue) => subscriber.next(innerValue),
                error: (err) => subscriber.error(err),
                complete: () => {
                  innerAbortController = void 0;
                  if (outerComplete) {
                    subscriber.complete();
                  }
                },
              },
              signal
            );
          },
          error: (err) => subscriber.error(err),
          complete: () => {
            outerComplete = true;
            if (!innerAbortController) {
              subscriber.complete();
            }
          },
        },
        signal
      );
    });
  }
}

class SafeSubscriber<T> implements Subscriber<T> {
  private _closed = false;

  private _signal = this._abortController.signal;

  constructor(
    private _destination: Partial<Observer<T>>,
    private _abortController: AbortController
  ) {}

  next(value: T) {
    if (!this._closed) {
      const { _destination } = this;
      if (typeof _destination.next === "function") {
        _destination.next(value, this._signal);
      }
    }
  }

  error(err: any) {
    if (!this._closed) {
      this._closed = true;
      const { _destination } = this;
      if (typeof _destination.error === "function") {
        _destination.error(err);
      } else {
        hostReportError(err);
      }
      this._abortController.abort();
    }
  }

  complete() {
    if (!this._closed) {
      this._closed = true;
      const { _destination } = this;
      if (typeof _destination.complete === "function") {
        _destination.complete();
      }
      this._abortController.abort();
    }
  }
}

function isPromiseLike<T>(input: any): input is PromiseLike<T> {
  return typeof input.then === "function" && typeof input.catch === "function";
}

function identity<T>(value: T): T {
  return value;
}
