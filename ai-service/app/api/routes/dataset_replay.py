from fastapi import APIRouter, Query, Request

from app.schemas.anomaly import (
    DatasetReplayCatalog,
    DatasetReplayRows,
    DatasetReplaySamples,
    DatasetReplaySelection,
)

router = APIRouter(prefix="/v1/dataset-replay", tags=["dataset replay"])


@router.get("/catalog", response_model=DatasetReplayCatalog)
def catalog(request: Request) -> DatasetReplayCatalog:
    return DatasetReplayCatalog(
        dataset="IMS Bearing",
        mode="DATASET_REPLAY",
        experiments=request.app.state.dataset_replay_service.catalog(),
    )


@router.get("/samples", response_model=DatasetReplaySamples)
def samples(
    request: Request,
    experiment: str = Query(min_length=1),
) -> DatasetReplaySamples:
    values, total = request.app.state.dataset_replay_service.samples(experiment)
    return DatasetReplaySamples(experiment=experiment, samples=values, total=total)


@router.post("/sample", response_model=DatasetReplayRows)
def sample(payload: DatasetReplaySelection, request: Request) -> DatasetReplayRows:
    return DatasetReplayRows(
        dataset="IMS Bearing",
        mode="DATASET_REPLAY",
        rows=request.app.state.dataset_replay_service.rows(payload.experiment, payload.timestamp),
    )
