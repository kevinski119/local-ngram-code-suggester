import java.util.List;
import java.util.Objects;
import java.util.Optional;

public final class WidgetManager {
    private final WidgetRepository repository;

    public WidgetManager(WidgetRepository repository) {
        this.repository = Objects.requireNonNull(repository);
    }

    public Optional<Widget> findById(String id) {
        if (id == null || id.isBlank()) {
            return Optional.empty();
        }
        return repository.findById(id);
    }

    public List<Widget> findActive() {
        return repository.findAll().stream()
            .filter(widget -> widget.isActive())
            .toList();
    }
}
