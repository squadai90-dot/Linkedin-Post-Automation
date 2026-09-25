/* What actually happened to a post, and when.
 *
 * Content has to answer three different questions about one row — when it was
 * scheduled for, when it was handed to Make, and when it really went out —
 * and they are three different timestamps. The rules for which of them apply
 * live here rather than in the markup, so the list and the detail cannot
 * drift apart and so they can be tested without a browser.
 *
 * The one rule underneath all of this: `published` is only ever the moment a
 * publication was confirmed. Never the scheduled time, never the moment the
 * webhook accepted the request, never "now". A post Make has taken but not
 * confirmed has no published time at all, and says so. */

import { zonedToUtc, secondsApart, localTimezone } from "./dates.js";

/* The exact instant the user asked for, from the date, time and zone they
   picked. Stored on the record when it is scheduled; recomputed here for
   rows saved by an older build that only kept the three parts. */
export function scheduledInstant(post) {
  if (!post) return null;
  if (post.scheduledFor) return post.scheduledFor;
  const date = post.scheduledDate || (post.state === "SCHEDULED" || post.scheduledHandoff ? post.date : null);
  if (!date) return null;
  const time = post.scheduledTime || post.time || "09:00";
  const tz = post.scheduledTz || post.tz || localTimezone();
  try { return zonedToUtc(date, time, tz).toISOString(); } catch { return null; }
}

export const scheduledZone = (post) => post?.scheduledTz || post?.tz || localTimezone();

export function postTimeline(post) {
  if (!post) return { rows: [], gapSeconds: null };
  const zone = scheduledZone(post);
  const scheduled = scheduledInstant(post);
  const published = post.publishedAt || null;

  /* Only worth a line of its own when Make is holding the post rather than
     having already published it. An immediate post that Make published in
     one round trip was "sent" and "published" in the same second, and two
     identical stamps tell the reader nothing. */
  const waiting = !published && (post.state === "SENT" || post.state === "HELD");
  const sentToMake = post.viaMake && post.sentAt && (waiting || post.scheduledHandoff) ? post.sentAt : null;

  const rows = [];
  if (scheduled) rows.push({ key: "scheduled", label: "Scheduled", at: scheduled, tz: zone });
  if (sentToMake) rows.push({ key: "sent", label: "Sent to Make", at: sentToMake, tz: zone });

  if (published) {
    rows.push({ key: "published", label: "Published", at: published, tz: zone });
  } else if (post.state === "SENT") {
    rows.push({ key: "published", label: "Published", at: null, tz: zone, pending: "Not yet confirmed" });
  } else if (post.state === "HELD") {
    rows.push({ key: "published", label: "Published", at: null, tz: zone, pending: "Not published — held in Make" });
  }

  return { rows, gapSeconds: scheduled && published ? secondsApart(scheduled, published) : null };
}

/* The one stamp a compact row can afford: what the post is waiting on, or
   when it went out. */
export function primaryStamp(post) {
  const { rows } = postTimeline(post);
  const published = rows.find((r) => r.key === "published" && r.at);
  if (published) return published;
  return rows.find((r) => r.key === "scheduled") || rows.find((r) => r.key === "sent") || null;
}
