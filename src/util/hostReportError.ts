/**
 * Copyright 2020 Ben Lesh <ben@benlesh.com>
 * MIT License
 */

export function hostReportError(err: any) {
    setTimeout(() => {
      throw err;
    });
  }
  