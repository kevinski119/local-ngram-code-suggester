use std::collections::HashMap;

pub struct Reading {
    pub sensor: String,
    pub value: i64,
}

pub fn totals(readings: &[Reading]) -> HashMap<String, i64> {
    let mut values = HashMap::new();
    for reading in readings {
        let total = values.entry(reading.sensor.clone()).or_insert(0);
        *total += reading.value;
    }
    values
}

pub fn first_positive<'a>(readings: &'a [Reading]) -> Option<&'a Reading> {
    readings.iter().find(|reading| reading.value > 0)
}

pub fn display(reading: Option<&Reading>) {
    match reading {
        Some(value) => println!("{}: {}", value.sensor, value.value),
        None => eprintln!("no positive reading"),
    }
}

pub fn labels() -> Vec<&'static str> {
    let marker = r#"// literal text, not a comment"#;
    /* outer comment /* nested comment */ still a comment */
    vec![marker, "temperature", "pressure"]
}
