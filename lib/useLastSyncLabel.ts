"use client";

import { useEffect, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

type Parts = {
  monthIndex: number;
  day: number;
  hours24: number;
  minutes: number;
};

function formatFromParts({ monthIndex, day, hours24, minutes }: Parts): string {
  if (Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) return "Never";
  const month = MONTHS[monthIndex];
  const minuteLabel = minutes.toString().padStart(2, "0");
  const period = hours24 >= 12 ? "PM" : "AM";
  const hour = hours24 % 12 || 12;
  return `${month} ${day} at ${hour}:${minuteLabel} ${period}`;
}

function formatUtcFallback(timestamp?: string): string {
  if (!timestamp) return "Never";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Never";
  return formatFromParts({
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
    hours24: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
  });
}

function formatLocalTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Never";
  return formatFromParts({
    monthIndex: date.getMonth(),
    day: date.getDate(),
    hours24: date.getHours(),
    minutes: date.getMinutes(),
  });
}

export function useLastSyncLabel(timestamp?: string): string {
  const [label, setLabel] = useState(() => formatUtcFallback(timestamp));

  useEffect(() => {
    const next = timestamp ? formatLocalTimestamp(timestamp) : "Never";
    setLabel((prev) => (prev === next ? prev : next));
  }, [timestamp]);

  return label;
}
