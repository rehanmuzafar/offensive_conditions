/**
 * Forum + writeup types — mirror forum-svc + writeup-svc APIs.
 */

import type { Tier, MachineDifficulty, Os } from "./index";

/* --------------------------------- forum ---------------------------------- */

export interface ForumCategory {
  slug: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  threadCount: number;
  postCount: number;
  color: string;
}

export interface ForumAuthor {
  username: string;
  avatarUrl: string | null;
  tier: Tier;
}

export interface ForumThread {
  id: string;
  title: string;
  categorySlug: string;
  categoryName: string;
  author: ForumAuthor;
  excerpt: string;
  replyCount: number;
  viewCount: number;
  voteScore: number;
  isPinned: boolean;
  isLocked: boolean;
  isSolved: boolean;
  tags: string[];
  createdAt: string;
  lastReplyAt: string;
  lastReplyBy: string | null;
}

export interface ForumPost {
  id: string;
  threadId: string;
  author: ForumAuthor;
  bodyMd: string;
  voteScore: number;
  userVote: 1 | 0 | -1;
  isAcceptedAnswer: boolean;
  isOriginalPost: boolean;
  createdAt: string;
  editedAt: string | null;
}

/* -------------------------------- writeups -------------------------------- */

export type WriteupTarget = { kind: "machine" | "challenge"; name: string; slug: string };

export interface Writeup {
  id: string;
  slug: string;
  title: string;
  author: ForumAuthor;
  target: WriteupTarget;
  os: Os | null;
  difficulty: MachineDifficulty | null;
  excerpt: string;
  readMinutes: number;
  voteScore: number;
  commentCount: number;
  tags: string[];
  publishedAt: string;
  // gated: only readable once you've rooted the target
  locked: boolean;
}

export interface WriteupDetail extends Writeup {
  bodyMd: string;
  userVote: 1 | 0 | -1;
}
