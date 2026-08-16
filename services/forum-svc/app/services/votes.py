"""Vote service: cast/change/clear votes, refresh aggregates."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ErrorCode
from app.core.logging import get_logger
from app.models import Post, PostVote, UserReputation

log = get_logger("votes")


class VoteService:
    def __init__(self, session: AsyncSession, *, self_vote_allowed: bool = False) -> None:
        self.session = session
        self._self_vote_allowed = self_vote_allowed

    async def cast(
        self,
        post_id: UUID,
        *,
        voter_id: UUID,
        direction: str,  # "up" | "down" | "clear"
    ) -> dict[str, int]:
        """Cast / change / clear a vote. Returns updated aggregates."""
        post_result = await self.session.execute(select(Post).where(Post.id == post_id))
        post = post_result.scalar_one_or_none()
        if not post or post.is_deleted:
            raise AppError(ErrorCode.POST_NOT_FOUND, "post not found")
        if not self._self_vote_allowed and post.author_id == voter_id:
            raise AppError(ErrorCode.SELF_VOTE_FORBIDDEN, "cannot vote on your own post")

        # Find existing vote
        existing = await self.session.execute(
            select(PostVote).where(
                and_(PostVote.post_id == post_id, PostVote.user_id == voter_id)
            )
        )
        vote = existing.scalar_one_or_none()

        if direction == "clear":
            if vote is not None:
                await self.session.delete(vote)
        elif direction == "up":
            if vote is None:
                self.session.add(PostVote(post_id=post_id, user_id=voter_id, direction=1))
            else:
                vote.direction = 1
        elif direction == "down":
            if vote is None:
                self.session.add(PostVote(post_id=post_id, user_id=voter_id, direction=-1))
            else:
                vote.direction = -1
        else:
            raise AppError(
                ErrorCode.INVALID_VOTE_DIRECTION,
                "direction must be 'up', 'down', or 'clear'",
            )

        await self.session.flush()
        return await self._refresh_post_aggregates(post_id, voter_id)

    async def _refresh_post_aggregates(
        self, post_id: UUID, voter_id: UUID
    ) -> dict[str, int]:
        result = await self.session.execute(
            select(
                func.count().filter(PostVote.direction == 1),
                func.count().filter(PostVote.direction == -1),
            ).where(PostVote.post_id == post_id)
        )
        upvotes, downvotes = result.one()
        upvotes = int(upvotes or 0)
        downvotes = int(downvotes or 0)
        score = upvotes - downvotes

        await self.session.execute(
            Post.__table__.update()
            .where(Post.id == post_id)
            .values(upvote_count=upvotes, downvote_count=downvotes, score=score)
        )

        # Get the voter's current direction (for response)
        my_vote_result = await self.session.execute(
            select(PostVote.direction).where(
                and_(PostVote.post_id == post_id, PostVote.user_id == voter_id)
            )
        )
        my_vote = my_vote_result.scalar_one_or_none() or 0

        await self.session.flush()
        return {
            "post_id": post_id,  # type: ignore[dict-item]
            "upvote_count": upvotes,
            "downvote_count": downvotes,
            "score": score,
            "my_vote": int(my_vote),
        }

    async def get_my_vote(self, post_id: UUID, *, voter_id: UUID) -> int:
        """Returns +1 / -1 / 0 for the voter's stance on a post."""
        result = await self.session.execute(
            select(PostVote.direction).where(
                and_(PostVote.post_id == post_id, PostVote.user_id == voter_id)
            )
        )
        return int(result.scalar_one_or_none() or 0)


class ReputationService:
    """Reputation computed from received upvotes/downvotes.

    Standard formula (matches StackOverflow-style):
      reputation = (upvotes_received * 10) - (downvotes_received * 2) + (solutions * 15)
    """

    UPVOTE_WEIGHT = 10
    DOWNVOTE_WEIGHT = 2
    SOLUTION_WEIGHT = 15

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: UUID) -> UserReputation:
        result = await self.session.execute(
            select(UserReputation).where(UserReputation.user_id == user_id)
        )
        rep = result.scalar_one_or_none()
        if not rep:
            # Lazily create a zero row
            rep = UserReputation(user_id=user_id)
            self.session.add(rep)
            await self.session.flush()
        return rep
