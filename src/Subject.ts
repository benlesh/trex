/**
 * Copyright 2020 Ben Lesh <ben@benlesh.com>
 * MIT License
 */

import { Observable } from "./Observable";
import { Observer, Subscriber } from "./types";

export class Subject<T> extends Observable<T> implements Observer<T> {
  private _subscribers: Subscriber<T>[] = [];
  private _closed = false;

  constructor() {
    super((subscriber, signal) => {
      this._subscribers.push(subscriber);
      const handler = () => {
        const index = this._subscribers.indexOf(subscriber);
        if (index >= 0) {
          this._subscribers.splice(index, 1);
        }
      };
      signal.addEventListener("abort", handler);
    });
  }

  next(value: T) {
    if (!this._closed) {
      for (const subscriber of this._subscribers) {
        subscriber.next(value);
      }
    }
  }

  error(err: any) {
    if (!this._closed) {
      this._closed = true;
      while (this._subscribers.length > 0) {
        this._subscribers.shift()!.error(err);
      }
    }
  }

  complete() {
    if (!this._closed) {
      this._closed = true;
      while (this._subscribers.length > 0) {
        this._subscribers.shift()!.complete();
      }
    }
  }

  asObservable(): Observable<T> {
    return new Observable<T>((subscriber, signal) => {
      this.subscribe(subscriber, signal);
    });
  }
}
