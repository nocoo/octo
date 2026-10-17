import { Badge, Button, Field, Input, LayerCard, Meter } from "@nocoo/basalt";
import { Banner } from "@nocoo/basalt/components/banner";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useModel } from "../components/layout/use-model";
import { SearchModel, scoreBars, snippetParts } from "../viewmodels/search";
import { Choice, MemoryFilters } from "./memories-filters";
import { MemoryLink } from "./memories-navigation";

export function SearchPage() {
	const [params, setParams] = useSearchParams();
	const model = useMemo(() => new SearchModel(), []);
	const state = useModel(model);
	const query = params.toString();
	useEffect(() => {
		void model.load(new URLSearchParams(query));
	}, [model, query]);
	const result = state.result;
	const maximum = Math.max(0, ...(result?.items.map((item) => item.scores.fused) ?? []));
	return (
		<div className="octo-page">
			<PageHeader
				title="Search"
				description="Full-text and semantic retrieval, with the evidence from every channel."
			/>
			<form
				key={query}
				className="octo-memory-stack"
				aria-label="Search options"
				onSubmit={(event) => {
					event.preventDefault();
					const form = new FormData(event.currentTarget);
					const next = new URLSearchParams(params);
					for (const key of ["q", "mode", "fusion", "k", "fts_weight", "vector_weight", "limit"])
						next.set(key, String(form.get(key) ?? ""));
					setParams(next);
				}}
			>
				<div className="octo-actions">
					<Field label="Search memories" htmlFor="search-query" required>
						<Input
							id="search-query"
							name="q"
							data-search-input
							defaultValue={params.get("q") ?? ""}
							placeholder="What do you want to remember?"
							required
						/>
					</Field>
					<Button type="submit" loading={state.loading}>
						Search
					</Button>
				</div>
				<div className="octo-memory-fields">
					<Choice
						label="Search mode"
						name="mode"
						value={params.get("mode") ?? "hybrid"}
						options={["hybrid", "fts", "vector"]}
					/>
					<Choice
						label="Fusion method"
						name="fusion"
						value={params.get("fusion") ?? "rrf"}
						options={["rrf", "weighted"]}
					/>
					<Field label="RRF k" htmlFor="search-k">
						<Input
							id="search-k"
							name="k"
							type="number"
							min={1}
							max={200}
							step={1}
							defaultValue={params.get("k") ?? "60"}
						/>
					</Field>
					<Field label="Full-text weight" htmlFor="search-fts-weight">
						<Input
							id="search-fts-weight"
							name="fts_weight"
							type="number"
							min={0}
							step={0.1}
							defaultValue={params.get("fts_weight") ?? "1"}
						/>
					</Field>
					<Field label="Vector weight" htmlFor="search-vector-weight">
						<Input
							id="search-vector-weight"
							name="vector_weight"
							type="number"
							min={0}
							step={0.1}
							defaultValue={params.get("vector_weight") ?? "1"}
						/>
					</Field>
					<Field label="Result limit" htmlFor="search-limit">
						<Input
							id="search-limit"
							name="limit"
							type="number"
							min={1}
							max={200}
							step={1}
							defaultValue={params.get("limit") ?? "50"}
						/>
					</Field>
				</div>
			</form>
			<MemoryFilters params={params} onChange={setParams} />
			{state.error && (
				<Banner
					variant="error"
					title="Search failed"
					description={state.error}
					action={<Banner.Action onClick={() => void model.load(params)}>Retry</Banner.Action>}
				/>
			)}
			{state.fallback && (
				<Banner
					variant="alert"
					title="Semantic search is unavailable"
					description={
						<>
							Showing full-text results with your filters.{" "}
							<Link to="/settings/embedding">Configure or test the embedding gateway</Link>.
						</>
					}
				/>
			)}
			{result?.channels.fts.partial && (
				<Banner
					variant="alert"
					title="Partial full-text results"
					description="The short-query scan reached its bounded candidate limit. Narrow the filters for more precise results."
				/>
			)}
			{result?.channels.vector.truncated && (
				<Banner
					variant="alert"
					title="Vector candidates were truncated"
					description="Post-filtering removed vector candidates. Narrow the query or filters to improve recall."
				/>
			)}
			{state.loading && <p role="status">Searching...</p>}
			{!params.get("q") && (
				<LayerCard>
					<LayerCard.Empty
						title="Search your knowledge"
						description="Enter a phrase. Hybrid combines full-text and semantic matches."
					/>
				</LayerCard>
			)}
			{result && (
				<>
					<div className="octo-actions" role="status">
						<span>{result.items.length} results</span>
						<Badge variant="outline">FTS candidates: {result.channels.fts.candidates}</Badge>
						<Badge variant="outline">
							Vector candidates: {result.channels.vector.candidates ?? "skipped"}
						</Badge>
						{result.channels.vector.profile && (
							<Badge variant="secondary">{result.channels.vector.profile}</Badge>
						)}
					</div>
					{!result.items.length && !state.loading && (
						<LayerCard>
							<LayerCard.Empty
								title="No matches"
								description="Try a different phrase or broaden your filters."
							/>
						</LayerCard>
					)}
					{result.items.map((item) => {
						const bars = scoreBars(item.scores, maximum);
						return (
							<LayerCard key={item.id}>
								<LayerCard.Header className="octo-actions">
									<MemoryLink memoryId={item.id} memoryTitle={item.title}>
										<strong>{item.title}</strong>
									</MemoryLink>
									<Badge variant="outline">{item.space}</Badge>
									<Badge variant="secondary">{item.type}</Badge>
								</LayerCard.Header>
								<LayerCard.Body className="octo-memory-stack">
									{item.snippet !== undefined && (
										<p>
											{snippetParts(item.snippet).map((part) =>
												part.marked ? <mark key={part.offset}>{part.text}</mark> : part.text,
											)}
										</p>
									)}
									<div className="octo-actions">
										{item.tags.map((tag) => (
											<Badge key={tag} variant="outline">
												{tag}
											</Badge>
										))}
										<time dateTime={item.updated_at} className="octo-muted">
											{new Date(item.updated_at).toLocaleString()}
										</time>
									</div>
									<div className="octo-memory-scores">
										<Meter
											label="Fused"
											value={bars.fused}
											customValue={item.scores.fused.toPrecision(4)}
										/>
										{item.scores.fts && bars.fts !== null ? (
											<div>
												<Meter
													label="FTS"
													value={bars.fts}
													customValue={`Rank ${item.scores.fts.rank}`}
												/>
												<span className="octo-muted">
													BM25 {item.scores.fts.bm25.toPrecision(4)}
												</span>
											</div>
										) : (
											<span className="octo-muted">FTS: no match</span>
										)}
										{item.scores.vector && bars.vector !== null ? (
											<div>
												<Meter
													label="Vector"
													value={bars.vector}
													customValue={`Rank ${item.scores.vector.rank}`}
												/>
												<span className="octo-muted">
													Cosine {item.scores.vector.similarity.toPrecision(4)}
												</span>
											</div>
										) : (
											<span className="octo-muted">Vector: no match</span>
										)}
									</div>
								</LayerCard.Body>
							</LayerCard>
						);
					})}
				</>
			)}
		</div>
	);
}
