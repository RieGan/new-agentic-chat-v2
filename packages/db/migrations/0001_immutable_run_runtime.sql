create function reject_run_runtime_change() returns trigger
language plpgsql
as $$
begin
  if new.runtime is distinct from old.runtime then
    raise exception 'run runtime is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger runs_runtime_immutable
before update of runtime on runs
for each row execute function reject_run_runtime_change();
