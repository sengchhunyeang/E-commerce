-- Telegram class reminder settings, edited on the /admin page.
-- One row (id = 1). Times are local class time (Asia/Phnom_Penh, UTC+7).

create table if not exists class_reminder (
    id           smallint   primary key default 1 check (id = 1),
    enabled      boolean    not null default true,
    chat_id      text       not null,
    meet_link    text       not null,
    alert_time   time       not null,              -- when the bot posts
    start_time   time       not null,              -- class starts
    end_time     time       not null,              -- class ends
    days         smallint[] not null default '{1,2,3,4,5,6,7}',  -- ISO weekdays, 1 = Monday
    message      text       not null,              -- {link}, {start}, {end} are filled in
    last_sent_on date                              -- stops a second send on the same day
);

insert into class_reminder (chat_id, meet_link, alert_time, start_time, end_time, message)
values ('-1003785397029', 'https://meet.google.com/smt-tbji-hxq', '18:30', '19:30', '20:30',
        E'Dear all student here is the link to join our class\n🕖 Time: {start}–{end}\n🔗 Join Google Meet:\n{link}')
on conflict (id) do nothing;
