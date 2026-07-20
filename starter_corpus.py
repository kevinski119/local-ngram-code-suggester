"""Deterministic, MIT-licensed starter corpus for cold-start completions.

The samples are generated from original templates so the bundled model has
useful structural observations without redistributing third-party source code.
Identifier variation deliberately teaches structure while allowing the
extension's project model to supply the user's real local symbols.
"""

DOMAINS = [
    'Account', 'Article', 'Audit', 'Catalog', 'Customer', 'Document',
    'Event', 'Invoice', 'Message', 'Order', 'Payment', 'Product',
    'Profile', 'Project', 'Report', 'Session', 'Task', 'Team',
    'Token', 'User', 'Workflow', 'Workspace', 'Notification', 'Subscription',
    'Address', 'Appointment', 'Asset', 'Comment', 'Config', 'Connection',
    'Contact', 'Dashboard', 'Device', 'File', 'Group', 'Job', 'Log', 'Metric',
    'Permission', 'Queue', 'Resource', 'Role', 'Rule', 'Schedule', 'Search',
    'Setting', 'Status', 'Transaction',
]


def _lower(name):
    return name[0].lower() + name[1:]


def _java_sample(name):
    value = _lower(name)
    return f"""
package example.local;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

public final class {name}Service {{
    private final {name}Repository repository;

    public {name}Service({name}Repository repository) {{
        this.repository = Objects.requireNonNull(repository);
    }}

    public Optional<{name}> findById(String id) {{
        if (id == null || id.isBlank()) {{
            return Optional.empty();
        }}
        return repository.findById(id);
    }}

    public List<{name}> findActive() {{
        return repository.findAll().stream()
            .filter({value} -> {value}.isActive())
            .sorted()
            .collect(Collectors.toList());
    }}

    public {name} save({name} {value}) {{
        Objects.requireNonNull({value});
        validate({value});
        return repository.save({value});
    }}

    public List<String> collectNames(List<{name}> values) {{
        List<String> names = new ArrayList<>();
        for ({name} value : values) {{
            if (value != null && value.isActive()) {{
                names.add(value.getName());
            }}
        }}
        return names;
    }}

    private void validate({name} {value}) {{
        if ({value}.getName() == null || {value}.getName().isBlank()) {{
            throw new IllegalArgumentException("name is required");
        }}
    }}
}}

interface {name}Repository {{
    Optional<{name}> findById(String id);
    List<{name}> findAll();
    {name} save({name} value);
}}
"""


def _json_sample(name, index):
    value = _lower(name)
    enabled = 'true' if index % 3 else 'false'
    return f"""
{{
  "name": "{value}-service",
  "version": "1.{index}.0",
  "enabled": {enabled},
  "retry": {{
    "attempts": 3,
    "delayMs": 250,
    "backoff": true
  }},
  "server": {{
    "host": "localhost",
    "port": 8080,
    "secure": false
  }},
  "features": [
    "search",
    "validation",
    "offline"
  ],
  "logging": {{
    "level": "info",
    "pretty": true
  }},
  "metadata": {{
    "domain": "{name}",
    "owner": "local-team",
    "tags": ["starter", "local", "private"]
  }}
}}
"""


def _typescript_sample(name):
    value = _lower(name)
    return f"""
export interface {name} {{
    id: string;
    name: string;
    active: boolean;
}}

export class {name}Store {{
    private readonly values = new Map<string, {name}>();

    add({value}: {name}): void {{
        if (!{value}.id) {{
            throw new Error("id is required");
        }}
        this.values.set({value}.id, {value});
    }}

    get(id: string): {name} | undefined {{
        return this.values.get(id);
    }}

    listActive(): {name}[] {{
        return Array.from(this.values.values())
            .filter(value => value.active)
            .sort((left, right) => left.name.localeCompare(right.name));
    }}

    async load(fetcher: () => Promise<{name}[]>): Promise<void> {{
        const values = await fetcher();
        for (const value of values) {{
            this.add(value);
        }}
    }}
}}
"""


def _javascript_sample(name):
    value = _lower(name)
    return f"""
export function create{name}Store() {{
    const values = new Map();

    function add({value}) {{
        if (!{value} || !{value}.id) {{
            throw new Error("id is required");
        }}
        values.set({value}.id, {value});
        return {value};
    }}

    function find(id) {{
        return values.get(id) ?? null;
    }}

    function listActive() {{
        return Array.from(values.values())
            .filter(value => value.active)
            .sort((left, right) => left.name.localeCompare(right.name));
    }}

    return {{ add, find, listActive }};
}}
"""


def _python_sample(name):
    value = _lower(name)
    return f"""
from dataclasses import dataclass
from typing import Iterable, Optional

@dataclass
class {name}:
    id: str
    name: str
    active: bool = True


class {name}Repository:
    def __init__(self) -> None:
        self._values: dict[str, {name}] = {{}}

    def save(self, {value}: {name}) -> {name}:
        if not {value}.id:
            raise ValueError("id is required")
        self._values[{value}.id] = {value}
        return {value}

    def find(self, identifier: str) -> Optional[{name}]:
        if not identifier:
            return None
        return self._values.get(identifier)

    def active(self) -> list[{name}]:
        return sorted(
            (value for value in self._values.values() if value.active),
            key=lambda value: value.name,
        )

    def save_all(self, values: Iterable[{name}]) -> list[{name}]:
        return [self.save(value) for value in values]
"""


def _csharp_sample(name):
    value = _lower(name)
    return f"""
using System;
using System.Collections.Generic;
using System.Linq;

public sealed class {name}Service
{{
    private readonly Dictionary<string, {name}> _values = new();

    public {name} Save({name} {value})
    {{
        ArgumentNullException.ThrowIfNull({value});
        if (string.IsNullOrWhiteSpace({value}.Id))
        {{
            throw new ArgumentException("Id is required.");
        }}
        _values[{value}.Id] = {value};
        return {value};
    }}

    public {name}? Find(string id)
    {{
        return _values.TryGetValue(id, out var value) ? value : null;
    }}

    public IReadOnlyList<{name}> Active()
    {{
        return _values.Values
            .Where(value => value.IsActive)
            .OrderBy(value => value.Name)
            .ToArray();
    }}
}}
"""


def _pygame_sample(index):
    offset = index * 8
    return f"""
import pygame

def layout_sprite(screen: pygame.Surface, sprite: pygame.Surface) -> tuple[int, int]:
    screen_width = screen.get_width()
    screen_height = screen.get_height()
    sprite_width = sprite.get_width()
    sprite_height = sprite.get_height()
    center_x = screen.get_width() / 2
    center_y = screen.get_height() / 2
    left = center_x - sprite.get_width() / 2 + {offset}
    top = center_y - sprite.get_height() / 2
    return int(left), int(top)

def current_surface_size() -> tuple[int, int]:
    surface = pygame.display.get_surface()
    if surface is None:
        return 0, 0
    return surface.get_width(), surface.get_height()
"""


def iter_starter_samples():
    """Yield (extension, generated source) pairs in a stable order."""
    for index, name in enumerate(DOMAINS):
        yield '.java', _java_sample(name)
        yield '.json', _json_sample(name, index)
        yield '.ts', _typescript_sample(name)
        yield '.py', _python_sample(name)
        if index % 2 == 0:
            yield '.js', _javascript_sample(name)
            yield '.cs', _csharp_sample(name)
    for index in range(16):
        yield '.py', _pygame_sample(index)
