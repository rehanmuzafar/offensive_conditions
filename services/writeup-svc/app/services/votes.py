"""Vote (writeup + comment) + Bookmark services."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Bookmark, Comment, CommentVote, Vote, Writeup

log = get_logger("votes")


class VoteService:
    """Voting for writeups + comments (shared logic)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def cast_writeup_vote(
        self, writeup_id: UUID, *, voter_id: UUID, direction: str
    ) -> dict:
        wr_result = await self.session.execute(
            select(Writeup).where(Writeup.id == writeup_id)
        )
        writeup = wr_result.scalar_one_or_none()
        if not writeup or writeup.deleted_at is not None:
            raise AppError(ErrorCode.WRITEUP_NOT_FOUND, "writeup not found")
        if writeup.author_id == voter_id:
            raise AppError(ErrorCode.SELF_VOTE_FORBIDDEN, "cannot vote on your own writeup")
        if writeup.status != "approved":
            raise AppError(ErrorCode.FORBIDDEN, "writeup not yet approved")

        existing = await self.session.execute(
            select(Vote).where(
                and_(Vote.writeup_id == writeup_id, Vote.user_id == voter_id)
            )
        )
        vote = existing.scalar_one_or_none()

        if direction == "clear":
            if vote is not None:
                await self.session.delete(vote)
        elif direction == "up":
            if vote is None:
                self.session.add(Vote(writeup_id=writeup_id, user_id=voter_id, direction=1))
            else:
                vote.direction = 1
        elif direction == "down":
            if vote is None:
                self.session.add(Vote(writeup_id=writeup_id, user_id=voter_id, direction=-1))
            else:
                vote.direction = -1
        else:
            raise AppError(
                ErrorCode.INVALID_VOTE_DIRECTION,
                "direction must be 'up', 'down', or 'clear'",
            )

        await self.session.flush()
        return await self._refresh_writeup_aggregates(writeup_id, voter_id)

    async def cast_comment_vote(
        self, comment_id: UUID, *, voter_id: UUID, direction: str
    ) -> dict:
        cm_result = await self.session.execute(
            select(Comment).where(Comment.id == comment_id)
        )
        comment = cm_result.scalar_one_or_none()
        if not comment or comment.is_deleted:
            raise AppError(ErrorCode.COMMENT_NOT_FOUND, "comment not found")
        if comment.author_id == voter_id:
            raise AppError(ErrorCode.SELF_VOTE_FORBIDDEN, "cannot vote on your own comment")

        existing = await self.session.execute(
            select(CommentVote).where(
                and_(CommentVote.comment_id == comment_id, CommentVote.user_id == voter_id)
            )
        )
        vote = existing.scalar_one_or_none()

        if direction == "clear":
            if vote is not None:
                await self.session.delete(vote)
        elif direction == "up":
            if vote is None:
                self.session.add(
                    CommentVote(comment_id=comment_id, user_id=voter_id, direction=1)
                )
            else:
                vote.direction = 1
        elif direction == "down":
            if vote is None:
                self.session.add(
                    CommentVote(comment_id=comment_id, user_id=voter_id, direction=-1)
                )
            else:
                vote.direction = -1
        else:
            raise AppError(
                ErrorCode.INVALID_VOTE_DIRECTION,
                "direction must be 'up', 'down', or 'clear'",
            )

        await self.session.flush()
        return await self._refresh_comment_aggregates(comment_id, voter_id)

    async def _refresh_writeup_aggregates(
        self, writeup_id: UUID, voter_id: UUID
    ) -> dict:
        result = await self.session.execute(
            select(
                func.count().filter(Vote.direction == 1),
                func.count().filter(Vote.direction == -1),
            ).where(Vote.writeup_id == writeup_id)
        )
        up, down = result.one()
        up = int(up or 0)
        down = int(down or 0)
        score = up - down
        await self.session.execute(
            Writeup.__table__.update()
            .where(Writeup.id == writeup_id)
            .values(upvote_count=up, downvote_count=down, score=score)
        )
        my_vote_result = await self.session.execute(
            select(Vote.direction).where(
                and_(Vote.writeup_id == writeup_id, Vote.user_id == voter_id)
            )
        )
        my_vote = my_vote_result.scalar_one_or_none() or 0
        await self.session.flush()
        return {
            "target_id": writeup_id,
            "upvote_count": up,
            "downvote_count": down,
            "score": score,
            "my_vote": int(my_vote),
        }

    async def _refresh_comment_aggregates(
        self, comment_id: UUID, voter_id: UUID
    ) -> dict:
        result = await self.session.execute(
            select(
                func.count().filter(CommentVote.direction == 1),
                func.count().filter(CommentVote.direction == -1),
            ).where(CommentVote.comment_id == comment_id)
        )
        up, down = result.one()
        up = int(up or 0)
        down = int(down or 0)
        score = up - down
        await self.session.execute(
            Comment.__table__.update()
            .where(Comment.id == comment_id)
            .values(upvote_count=up, downvote_count=down, score=score)
        )
        my_vote_result = await self.session.execute(
            select(CommentVote.direction).where(
                and_(
                    CommentVote.comment_id == comment_id,
                    CommentVote.user_id == voter_id,
                )
            )
        )
        my_vote = my_vote_result.scalar_one_or_none() or 0
        await self.session.flush()
        return {
            "target_id": comment_id,
            "upvote_count": up,
            "downvote_count": down,
            "score": score,
            "my_vote": int(my_vote),
        }


class BookmarkService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(
        self, writeup_id: UUID, *, user_id: UUID, note: str | None = None
    ) -> Bookmark:
        # Verify writeup
        wr_result = await self.session.execute(
            select(Writeup).where(
                and_(Writeup.id == writeup_id, Writeup.deleted_at.is_(None))
            )
        )
        if wr_result.scalar_one_or_none() is None:
            raise AppError(ErrorCode.WRITEUP_NOT_FOUND, "writeup not found")

        bookmark = Bookmark(writeup_id=writeup_id, user_id=user_id, note=note)
        self.session.add(bookmark)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise AppError(ErrorCode.ALREADY_BOOKMARKED, "already bookmarked")

        await self.session.execute(
            Writeup.__table__.update()
            .where(Writeup.id == writeup_id)
            .values(bookmark_count=Writeup.bookmark_count + 1)
        )
        await self.session.flush()
        log.info("bookmark_added", writeup_id=str(writeup_id), user=str(user_id))
        return bookmark

    async def remove(self, writeup_id: UUID, *, user_id: UUID) -> None:
        result = await self.session.execute(
            select(Bookmark).where(
                and_(
                    Bookmark.writeup_id == writeup_id,
                    Bookmark.user_id == user_id,
                )
            )
        )
        bm = result.scalar_one_or_none()
        if not bm:
            raise AppError(ErrorCode.NOT_BOOKMARKED, "not bookmarked")
        await self.session.delete(bm)
        await self.session.execute(
            Writeup.__table__.update()
            .where(Writeup.id == writeup_id)
            .values(bookmark_count=Writeup.bookmark_count - 1)
        )
        await self.session.flush()

    async def list_my(
        self, user_id: UUID, *, limit: int = 25, offset: int = 0
    ) -> tuple[list, int]:
        stmt = (
            select(Bookmark)
            .where(Bookmark.user_id == user_id)
            .order_by(Bookmark.created_at.desc())
        )
        count_stmt = (
            select(func.count())
            .select_from(Bookmark)
            .where(Bookmark.user_id == user_id)
        )
        total = (await self.session.execute(count_stmt)).scalar_one()
        result = await self.session.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all()), int(total)
