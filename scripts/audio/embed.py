"""Meaning vectors of texts (lyrics, searches) from a local multilingual model, to search songs by mood or theme.

python embed.py --check
python embed.py --serve          # one JSON request per line on stdin, one answer per line on stdout

A request is {"id": ..., "kind": "query" | "passage", "texts": [...]}; the answer {"id": ..., "vectors": [[...], ...]}.
Vectors are normalised, so their dot product is the cosine similarity. The model loads once and stays loaded.
"""
import argparse
import json
from pathlib import Path
import sys

MODEL = 'intfloat/multilingual-e5-small'
# e5 models are trained with these prefixes: a search, and the texts it is matched against.
PREFIX = {'query': 'query: ', 'passage': 'passage: '}

def load(cache):
    import torch
    from sentence_transformers import SentenceTransformer
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    return SentenceTransformer(MODEL, device=device, cache_folder=str(cache / 'embeddings')), device

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('.local/audio/models'))
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()
    if args.check:
        import torch
        import sentence_transformers  # noqa: F401
        print(json.dumps(dict(ready=True, model=MODEL, device='cuda' if torch.cuda.is_available() else 'cpu')))
        return
    if not args.serve: parser.error('usa --serve o --check')
    model, device = load(args.cache.resolve())
    print(json.dumps(dict(ready=True, model=MODEL, device=device, dimensions=model.get_sentence_embedding_dimension())), flush=True)
    for line in sys.stdin:
        try:
            request = json.loads(line)
            kind, texts = request.get('kind'), request.get('texts')
            if kind not in PREFIX or not isinstance(texts, list) or not all(isinstance(text, str) for text in texts): raise ValueError('Petición no válida.')
            vectors = model.encode([PREFIX[kind] + text for text in texts], normalize_embeddings=True, batch_size=16, convert_to_numpy=True) if texts else []
            answer = dict(id=request.get('id'), vectors=[[round(float(v), 5) for v in vector] for vector in vectors])
        except Exception as error:
            answer = dict(id=request.get('id') if isinstance(request, dict) else None, error=str(error)[:300])
        print(json.dumps(answer), flush=True)

if __name__ == '__main__': main()
